//! Bundles src/ into a single self-contained dist/arduino-ide.html: a small boot script (with
//! the boot decoder's WebAssembly) plus compressed packs: the app (JavaScript + the Rust core),
//! and if prepared, the compiler and the examples.
//!
//! The JavaScript is bundled by esbuild (from node_modules), which also inlines CodeMirror.

use crate::util::{self, compress, embed, exec, read, read_text, root, write, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

fn cargo() -> Command {
    Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
}

/// Builds crates/wasm and crates/boot to WebAssembly, with their JavaScript bindings in
/// build/cache/wasm/{core,boot}.
pub fn build_wasm() -> Result {
    let root = root();
    exec(cargo().current_dir(&root).args(["build", "--quiet", "--release", "--target", "wasm32-unknown-unknown", "-p", "aide-wasm", "-p", "aide-boot"]))?;
    let target = root.join("target/wasm32-unknown-unknown/release");
    let have_wasm_opt = Command::new("wasm-opt").arg("--version").output().is_ok_and(|o| o.status.success());
    if !have_wasm_opt {
        eprintln!("wasm-opt (binaryen) not found: the WebAssembly won't be size-optimised. See README.");
    }
    for (name, dir) in [("aide_wasm", "core"), ("aide_boot", "boot")] {
        let out_dir = root.join("build/cache/wasm").join(dir);
        exec(Command::new("wasm-bindgen").args(["--target", "web", "--out-dir"]).arg(&out_dir).arg(target.join(format!("{name}.wasm"))))
            .map_err(|e| format!("{e}\nInstall the wasm-bindgen CLI matching crates/wasm/Cargo.toml (see README)."))?;
        if have_wasm_opt {
            let wasm = out_dir.join(format!("{name}_bg.wasm"));
            exec(Command::new("wasm-opt").arg("-Oz").args(WASM_FEATURES).arg(&wasm).arg("-o").arg(&wasm))?;
        }
    }
    Ok(())
}

// What rustc's wasm32 target uses by default; Chrome 100 has all of them.
const WASM_FEATURES: [&str; 6] = ["--enable-bulk-memory", "--enable-sign-ext", "--enable-mutable-globals", "--enable-nontrapping-float-to-int", "--enable-multivalue", "--enable-reference-types"];

// The page is windows-1252 (see aide_core::embed), so everything but the packs must be ASCII.
fn ascii(what: &str, text: String) -> Result<String> {
    match text.char_indices().find(|(_, c)| !c.is_ascii()) {
        None => Ok(text),
        Some((i, c)) => Err(format!("{what} must be ASCII: found {c:?} at byte {i} (use an escape such as \\25CF in CSS or &#x25CF; in HTML)")),
    }
}

fn esbuild(root: &Path, args: &[&str]) -> Result<String> {
    let bin = root.join("node_modules/esbuild/bin/esbuild");
    if !bin.exists() {
        return Err("esbuild not found: run npm install".into());
    }
    let common = ["--bundle", "--format=iife", "--target=chrome100", "--log-level=error", "--loader:.wasm=binary", "--loader:.txt=text"];
    let out = util::output(Command::new("node").current_dir(root).arg(bin).args(common).args(args))?;
    String::from_utf8(out).map_err(|_| "esbuild output isn't UTF-8".to_string())
}

// The newest change under the sources, for --watch.
fn newest(paths: &[PathBuf]) -> SystemTime {
    fn walk(p: &Path, best: &mut SystemTime) {
        if let Ok(meta) = std::fs::metadata(p) {
            if meta.is_dir() {
                for e in std::fs::read_dir(p).into_iter().flatten().flatten() {
                    walk(&e.path(), best);
                }
            } else if let Ok(t) = meta.modified() {
                *best = (*best).max(t);
            }
        }
    }
    let mut best = SystemTime::UNIX_EPOCH;
    for p in paths {
        walk(p, &mut best);
    }
    best
}

pub fn run(watch: bool, no_compiler: bool) -> Result {
    let root = root();
    if !watch {
        return build(&root, no_compiler, true);
    }
    let rust = [root.join("crates")];
    let js = [root.join("src"), root.join("licenses")];
    let (mut rust_seen, mut js_seen) = (newest(&rust), newest(&js));
    if let Err(e) = build(&root, no_compiler, false) {
        eprintln!("error: {e}");
    }
    println!("Watching src/ and crates/ for changes…");
    loop {
        std::thread::sleep(Duration::from_millis(500));
        let (r, j) = (newest(&rust), newest(&js));
        if r == rust_seen && j == js_seen {
            continue;
        }
        let rust_changed = r != rust_seen;
        (rust_seen, js_seen) = (r, j);
        let result = if rust_changed { build(&root, no_compiler, false) } else { assemble(&root, no_compiler, false) };
        if let Err(e) = result {
            eprintln!("error: {e}");
        }
    }
}

fn build(root: &Path, no_compiler: bool, minify: bool) -> Result {
    build_wasm()?;
    assemble(root, no_compiler, minify)
}

fn assemble(root: &Path, no_compiler: bool, minify: bool) -> Result {
    let cache = root.join("build/cache");
    let pack_file = cache.join("compiler-pack.bin.lzma");
    let examples_file = cache.join("examples.json.lzma");
    let with_compiler = !no_compiler && pack_file.exists();
    let with_examples = examples_file.exists();
    if !with_compiler && !no_compiler {
        eprintln!("Compiler pack not found; building without the compiler. Run: cargo aide prepare-compiler");
    }
    if !with_examples {
        eprintln!("Examples not found; building without them. Run: cargo aide prepare-examples");
    }
    let pkg: Value = serde_json::from_str(&read_text(&root.join("package.json"))?).map_err(|e| format!("package.json: {e}"))?;
    let version = pkg["version"].as_str().unwrap_or("0.0.0").to_string();
    let date = util::today();

    // The compiler worker's source is inlined into the app as text ("#compiler-worker").
    let worker_file = cache.join("compiler-worker.txt");
    if with_compiler {
        // Emscripten glue references Node modules behind runtime checks that are false in a browser.
        let externals = ["node:*", "module", "fs", "path", "crypto", "url", "worker_threads", "child_process"].map(|m| format!("--external:{m}"));
        let mut args = vec!["src/compiler/worker.js", "--minify", "--supported:top-level-await=true"];
        args.extend(externals.iter().map(String::as_str));
        write(&worker_file, esbuild(root, &args)?)?;
    } else {
        write(&worker_file, "")?;
    }

    // "</script" inside inline content would end the <script> element early; "<\/script" is equivalent in JS.
    let boot = ascii("the boot script", esbuild(root, &["src/boot.js", "--minify", "--charset=ascii"])?)?;
    let boot = regex_lite::Regex::new(r"(?i)</(script)").unwrap().replace_all(&boot, r"<\/$1").into_owned();

    let meta_file = cache.join("app-meta.json");
    let define_version = format!("--define:__APP_VERSION__={}", json!(version));
    let define_date = format!("--define:__BUILD_DATE__={}", json!(date));
    let metafile = format!("--metafile={}", meta_file.display());
    let app_file = cache.join("app.js");
    let outfile = format!("--outfile={}", app_file.display());
    let mut args = vec!["src/app.js", "--charset=utf8", "--legal-comments=eof", &define_version, &define_date, &metafile, &outfile];
    if minify {
        args.push("--minify");
    }
    esbuild(root, &args)?;
    let app = read_text(&app_file)?;

    // The Rust core travels as its own pack: raw bytes compress better than base64 in the app.
    let core = read(&cache.join("wasm/core/aide_wasm_bg.wasm"))?;
    let mut packs = vec![embed("app-pack", &compress(app.as_bytes())?), embed("core-pack", &compress(&core)?)];
    if with_compiler {
        packs.push(embed("compiler-pack", &read(&pack_file)?));
    }
    if with_examples {
        packs.push(embed("examples-pack", &read(&examples_file)?));
    }
    let about = about_data(root, &meta_file, &version, &date)?;
    packs.push(embed("about-pack", &compress(about.to_string().as_bytes())?));

    let html = ascii("src/index.html", read_text(&root.join("src/index.html"))?)?;
    let css = ascii("src/styles.css", read_text(&root.join("src/styles.css"))?)?;
    let html = html.replacen("/*INLINE_CSS*/", &css, 1).replacen("/*BOOT_JS*/", &boot, 1);
    let (before, after) = html.split_once("<!--PACKS-->").ok_or("src/index.html has no <!--PACKS--> marker")?;
    let mut out = before.as_bytes().to_vec();
    out.extend(packs.join(&b'\n'));
    out.extend_from_slice(after.as_bytes());
    let out_file = root.join("dist/arduino-ide.html");
    write(&out_file, &out)?;
    println!(
        "Built dist/arduino-ide.html ({}{}{})",
        util::mb(out.len()),
        if with_compiler { ", with compiler" } else { ", no compiler" },
        if with_examples { ", with examples" } else { "" }
    );
    Ok(())
}

fn license_text(dir: &Path, license: &str) -> Result<String> {
    let files: Vec<PathBuf> = util::list_dir(dir)?
        .into_iter()
        .filter(|p| p.is_file() && util::file_name(p).to_ascii_lowercase().starts_with("licen"))
        .collect();
    // Dual-licensed crates (MIT OR Apache-2.0) are used under MIT.
    let mit: Vec<&PathBuf> = files.iter().filter(|p| util::file_name(p).to_ascii_uppercase().contains("MIT")).collect();
    let chosen: Vec<&PathBuf> = if license.contains("MIT") && !mit.is_empty() { mit } else { files.iter().collect() };
    if chosen.is_empty() {
        return Err(format!("{} has no license file", dir.display()));
    }
    Ok(chosen.iter().map(|p| read_text(p)).collect::<Result<Vec<_>>>()?.join("\n\n"))
}

// The Rust crates compiled into the page's WebAssembly (dependencies of crates/wasm and crates/boot).
fn rust_packages(root: &Path) -> Result<Vec<Value>> {
    let out = util::output(cargo().current_dir(root).args(["metadata", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown"]))?;
    let meta: Value = serde_json::from_slice(&out).map_err(|e| format!("cargo metadata: {e}"))?;
    let members: Vec<&str> = meta["workspace_members"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let nodes: BTreeMap<&str, &Value> = meta["resolve"]["nodes"].as_array().into_iter().flatten().filter_map(|n| Some((n["id"].as_str()?, n))).collect();
    let packages: BTreeMap<&str, &Value> = meta["packages"].as_array().into_iter().flatten().filter_map(|p| Some((p["id"].as_str()?, p))).collect();

    let starts: Vec<&str> = packages.iter().filter(|(_, p)| matches!(p["name"].as_str(), Some("aide-wasm" | "aide-boot"))).map(|(id, _)| *id).collect();
    let mut seen: Vec<&str> = Vec::new();
    let mut stack = starts;
    while let Some(id) = stack.pop() {
        if seen.contains(&id) {
            continue;
        }
        seen.push(id);
        for dep in nodes.get(id).and_then(|n| n["deps"].as_array()).into_iter().flatten() {
            // Normal dependencies only: build scripts and macros don't end up in the page.
            let normal = dep["dep_kinds"].as_array().into_iter().flatten().any(|k| k["kind"].is_null());
            if normal {
                if let Some(p) = dep["pkg"].as_str() {
                    stack.push(p);
                }
            }
        }
    }
    let mut out = Vec::new();
    for id in seen.into_iter().filter(|id| !members.contains(id)) {
        let p = packages[id];
        let name = p["name"].as_str().unwrap_or_default();
        // Procedural macros run at compile time; their code isn't in the page.
        if p["targets"].as_array().into_iter().flatten().any(|t| t["kind"].as_array().is_some_and(|k| k.iter().any(|k| k == "proc-macro"))) {
            continue;
        }
        let license = p["license"].as_str().unwrap_or_default();
        let dir = Path::new(p["manifest_path"].as_str().unwrap_or_default()).parent().unwrap_or(Path::new("")).to_path_buf();
        let text = license_text(&dir, license).map_err(|e| format!("Rust crate {name}: {e}"))?;
        out.push(json!({ "name": format!("{name} (Rust)"), "version": p["version"], "license": license, "text": text }));
    }
    Ok(out)
}

// About/licenses data: components and license texts (licenses/), the exact compiler sources
// (toolchain/out/SOURCES.md), every npm package that ended up in the bundle, and the Rust crates
// in the WebAssembly.
fn about_data(root: &Path, meta_file: &Path, version: &str, date: &str) -> Result<Value> {
    let licenses = root.join("licenses");
    let mut components: Value = serde_json::from_str(&read_text(&licenses.join("components.json"))?).map_err(|e| format!("components.json: {e}"))?;
    if let Some(texts) = components["texts"].as_object_mut() {
        for t in texts.values_mut() {
            let file = t["file"].as_str().ok_or("components.json: text without a file")?.to_string();
            t["text"] = read_text(&licenses.join(file))?.into();
        }
    }

    let meta: Value = serde_json::from_str(&read_text(meta_file)?).map_err(|e| format!("esbuild metafile: {e}"))?;
    let re = regex_lite::Regex::new(r"node_modules/((@[^/]+/)?[^/]+)/").unwrap();
    let mut packages: BTreeMap<String, Value> = BTreeMap::new();
    for input in meta["inputs"].as_object().into_iter().flat_map(|o| o.keys()) {
        let Some(m) = re.captures(input) else { continue };
        let name = m[1].to_string();
        if packages.contains_key(&name) {
            continue;
        }
        let dir = root.join("node_modules").join(&name);
        let pkg: Value = serde_json::from_str(&read_text(&dir.join("package.json"))?).map_err(|e| format!("{name}/package.json: {e}"))?;
        let license = pkg["license"].as_str().unwrap_or_default().to_string();
        let text = license_text(&dir, &license).map_err(|_| format!("Bundled package {name} has no license file"))?;
        packages.insert(name.clone(), json!({ "name": name, "version": pkg["version"], "license": license, "text": text }));
    }
    let mut packages: Vec<Value> = packages.into_values().collect();
    packages.extend(rust_packages(root)?);

    let sources = root.join("toolchain/out/SOURCES.md");
    Ok(json!({
        "app": { "version": version, "date": date },
        "components": components["components"],
        "texts": components["texts"],
        "packages": packages,
        "compilerSources": if sources.exists() { read_text(&sources)? } else { String::new() },
    }))
}
