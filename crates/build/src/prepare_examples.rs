//! Builds the examples/libraries data embedded in the IDE (build/cache/examples.json.lzma):
//! - Arduino's built-in examples (github.com/arduino/arduino-examples, CC0)
//! - the classroom sensor kit's starter sketches (examples/SensorKit)
//! - every example that ships with the bundled libraries
//! Each example is compiled with the in-browser toolchain (run by Node: build/check-examples.mjs);
//! only those that build for the Uno are kept.
//!
//! Needs the compiler pack (cargo aide prepare-compiler) and arduino-cli with the libraries.

use crate::util::{self, arduino_dir, compress, file_name, list_dir, read, read_text, root, write, Result};
use aide_core::collate;
use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

const EXAMPLES_TAG: &str = "1.10.3";
const EXAMPLES_SHA256: &str = "cc7397c9b50ba5efc634a7c605522f49b5dd422f9c097fff17899fe921d0f006";
const CORE_VERSION: &str = "1.8.8";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct File {
    name: String,
    code: String,
}

#[derive(Debug, Clone, Serialize)]
struct Example {
    name: String,
    files: Vec<File>,
}

#[derive(Serialize)]
struct Category {
    category: String,
    examples: Vec<Example>,
}

fn is_sketch_file(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    [".ino", ".h", ".hpp", ".cpp"].iter().any(|e| n.ends_with(e))
}

fn builtin_archive(cache_dir: &Path) -> Result<Vec<(String, Vec<u8>)>> {
    let zip_path = cache_dir.join(format!("arduino-examples-{EXAMPLES_TAG}.zip"));
    if !zip_path.exists() {
        let url = format!("https://codeload.github.com/arduino/arduino-examples/zip/refs/tags/{EXAMPLES_TAG}");
        println!("Downloading {url}");
        std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
        util::exec(Command::new("curl").args(["-sSfL", "-o"]).arg(&zip_path).arg(&url))?;
    }
    let buf = read(&zip_path)?;
    let sha: String = Sha256::digest(&buf).iter().map(|b| format!("{b:02x}")).collect();
    if sha != EXAMPLES_SHA256 {
        return Err(format!("Checksum mismatch for {}: {sha}", zip_path.display()));
    }
    crate::zip::read(&buf)
}

// ---------- Collect examples ----------

/// Main .ino first, then the rest alphabetically (the Arduino IDE's tab order).
fn order_files(mut files: Vec<File>, sketch_name: &str) -> Vec<File> {
    let main_name = format!("{sketch_name}.ino");
    let i = files.iter().position(|f| f.name == main_name).unwrap_or(0);
    let main = files.remove(i);
    files.sort_by(|a, b| collate::compare(&a.name, &b.name));
    std::iter::once(main).chain(files).collect()
}

struct Builtin {
    category_dir: String,
    category: String,
    example: Example,
}

// Built-in: "<prefix>/examples/01.Basics/Blink/Blink.ino" -> category "Basics", example "Blink".
fn builtin_examples(zip: Vec<(String, Vec<u8>)>) -> Vec<Builtin> {
    let re = Regex::new(r"^[^/]+/examples/([^/]+)/(.+)/([^/]+)$").unwrap();
    let mut by_dir: BTreeMap<String, (String, String, Vec<File>)> = BTreeMap::new();
    let mut order = Vec::new();
    for (name, data) in zip {
        let Some(m) = re.captures(&name) else { continue };
        if !is_sketch_file(&m[3]) {
            continue;
        }
        let key = format!("{}/{}", &m[1], &m[2]);
        if !by_dir.contains_key(&key) {
            order.push(key.clone());
        }
        let entry = by_dir.entry(key).or_insert_with(|| (m[1].to_string(), m[2].to_string(), vec![]));
        entry.2.push(File { name: m[3].to_string(), code: String::from_utf8_lossy(&data).into_owned() });
    }
    let digits_dot = Regex::new(r"^\d+\.").unwrap();
    let mut out = Vec::new();
    for key in order {
        let (category_dir, dir, files) = by_dir.remove(&key).unwrap();
        let ex_name = dir.rsplit('/').next().unwrap_or(&dir).to_string();
        if !files.iter().any(|f| f.name == format!("{ex_name}.ino")) {
            continue;
        }
        let category = digits_dot.replace(&category_dir, "").replace('_', " ");
        out.push(Builtin { category_dir, category, example: Example { name: dir, files: order_files(files, &ex_name) } });
    }
    out
}

/// Sketch folders under dir/sub (a library's examples/, or a folder of our own examples).
fn library_examples(dir: &Path, sub: &str) -> Result<Vec<Example>> {
    fn walk(d: &Path, rel: &str, out: &mut Vec<Example>) -> Result {
        if !d.exists() {
            return Ok(());
        }
        for p in list_dir(d)? {
            if !p.is_dir() {
                continue;
            }
            let name = file_name(&p);
            let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            // Older libraries still ship sketches as .pde, the pre-2011 extension; they're opened as .ino.
            if p.join(format!("{name}.ino")).exists() || p.join(format!("{name}.pde")).exists() {
                let mut files = Vec::new();
                for f in list_dir(&p)? {
                    let fname = file_name(&f);
                    let pde = fname.to_ascii_lowercase().ends_with(".pde");
                    if (is_sketch_file(&fname) || pde) && f.is_file() {
                        let shown = if pde { format!("{}.ino", &fname[..fname.len() - 4]) } else { fname };
                        files.push(File { name: shown, code: read_text(&f)? });
                    }
                }
                out.push(Example { name: r, files: order_files(files, &name) });
            } else {
                walk(&p, &r, out)?;
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(&dir.join(sub), "", &mut out)?;
    out.sort_by(|a, b| collate::compare(&a.name, &b.name));
    Ok(out)
}

// ---------- Library licenses (curated in licenses/libraries.json) ----------

/// The first /* ... */ comment that states a license, with comment decoration removed.
fn license_comment(text: &str) -> Option<String> {
    let comment = Regex::new(r"(?s)/\*(.*?)\*/").unwrap();
    let licensey = Regex::new(r"(?i)copyright|licen[cs]e|permission is hereby").unwrap();
    let decoration = Regex::new(r"^\s*\*?\s?").unwrap();
    let found = comment.captures_iter(text).map(|m| m[1].to_string()).find(|c| licensey.is_match(c))?;
    Some(found.split('\n').map(|l| decoration.replace(l, "").into_owned()).collect::<Vec<_>>().join("\n").trim().to_string())
}

/// An AsciiDoc "== Section ==" up to the next heading.
fn doc_section(text: &str, name: &str) -> Option<String> {
    let lines: Vec<&str> = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    let heading = Regex::new(&format!(r"(?i)^==\s*{}\s*(==)?\s*$", regex_lite::escape(name))).unwrap();
    let next = Regex::new(r"^==\s").unwrap();
    let start = lines.iter().position(|l| heading.is_match(l))?;
    let end = lines.iter().enumerate().position(|(i, l)| i > start && next.is_match(l)).unwrap_or(lines.len());
    Some(lines[start + 1..end].join("\n").trim().to_string())
}

#[derive(Serialize)]
struct LicenseText {
    title: String,
    text: String,
}

#[derive(Deserialize)]
struct LicenseInfo {
    license: String,
    #[serde(default)]
    note: String,
    notice: Option<Notice>,
    texts: Option<Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    repo_file: Option<String>,
    file: Option<String>,
    section: Option<String>,
}

struct LibraryLicense {
    license: String,
    note: String,
    texts: Vec<LicenseText>,
    shared: Value,
}

fn library_license(name: &str, dir: &Path, licenses_dir: &Path, all: &BTreeMap<String, Value>) -> Result<LibraryLicense> {
    let info = all.get(name).ok_or_else(|| format!("No license entry for library {name}: add it to licenses/libraries.json after checking its license."))?;
    let info: LicenseInfo = serde_json::from_value(info.clone()).map_err(|e| format!("licenses/libraries.json, {name}: {e}"))?;
    let license_file = Regex::new(r"(?i)^(licen[cs]e|copying)").unwrap();
    let mut texts = Vec::new();
    for f in list_dir(dir)? {
        let title = file_name(&f);
        if license_file.is_match(&title) && f.is_file() {
            texts.push(LicenseText { text: read_text(&f)?, title });
        }
    }
    if let Some(n) = &info.notice {
        let text = if let Some(repo_file) = &n.repo_file {
            Some(read_text(&licenses_dir.join(repo_file))?.trim().to_string())
        } else {
            let file = n.file.as_deref().ok_or_else(|| format!("{name}: notice needs file or repoFile"))?;
            let src = read_text(&dir.join(file))?;
            match &n.section {
                Some(section) => doc_section(&src, section),
                None => license_comment(&src),
            }
        };
        let text = text.filter(|t| !t.is_empty()).ok_or_else(|| format!("Couldn't find the license notice for {name} ({})", serde_json::to_string(n).unwrap_or_default()))?;
        let title = match (&n.repo_file, &n.file) {
            (Some(_), _) => "License notice".to_string(),
            (None, Some(f)) => format!("License notice in {f}"),
            (None, None) => unreachable!(),
        };
        texts.push(LicenseText { title, text });
    }
    if texts.is_empty() && info.texts.is_none() {
        return Err(format!("Library {name} has no license text to show"));
    }
    Ok(LibraryLicense { license: info.license, note: info.note, texts, shared: info.texts.unwrap_or(Value::Array(vec![])) })
}

fn read_properties(dir: &Path) -> Result<BTreeMap<String, String>> {
    let file = dir.join("library.properties");
    let re = Regex::new(r"^([\w.]+)=(.*)$").unwrap();
    let mut props = BTreeMap::new();
    if file.exists() {
        for line in read_text(&file)?.split('\n') {
            let line = line.strip_suffix('\r').unwrap_or(line);
            if let Some(m) = re.captures(line) {
                props.insert(m[1].to_string(), m[2].trim().to_string());
            }
        }
    }
    Ok(props)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryData {
    name: String,
    display_name: String,
    version: String,
    author: String,
    sentence: String,
    paragraph: String,
    url: String,
    license: String,
    license_note: String,
    license_texts: Vec<LicenseText>,
    shared_texts: Value,
    includes: Vec<String>,
    examples: Vec<Example>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExamplesData {
    created_at: String,
    builtin_source: String,
    kit: Vec<Category>,
    builtin: Vec<Category>,
    libraries: Vec<LibraryData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackLibrary {
    name: String,
    display_name: String,
    version: String,
    headers: Vec<String>,
}

#[derive(Deserialize)]
struct PackManifest {
    libraries: Vec<PackLibrary>,
}

/// Which examples compile with the WebAssembly toolchain (run in Node; see build/check-examples.mjs).
fn compiles(root: &Path, examples: &[&Example]) -> Result<Vec<bool>> {
    let cache = root.join("build/cache");
    let input = cache.join("check-examples.in.json");
    let output = cache.join("check-examples.out.json");
    let files: Vec<&Vec<File>> = examples.iter().map(|e| &e.files).collect();
    write(&input, serde_json::to_vec(&files).unwrap())?;
    util::exec(Command::new("node").current_dir(root).arg("build/check-examples.mjs").arg(&input).arg(&output))?;
    let result: Vec<bool> = serde_json::from_str(&read_text(&output)?).map_err(|e| format!("check-examples: {e}"))?;
    let _ = std::fs::remove_file(&input);
    let _ = std::fs::remove_file(&output);
    if result.len() != examples.len() {
        return Err("check-examples returned the wrong number of results".into());
    }
    Ok(result)
}

pub fn run() -> Result {
    let root = root();
    let cache_dir = root.join("build/cache");
    let out_file = cache_dir.join("examples.json.lzma");
    let licenses_dir = root.join("licenses");
    let library_licenses: BTreeMap<String, Value> = serde_json::from_str(&read_text(&licenses_dir.join("libraries.json"))?).map_err(|e| format!("licenses/libraries.json: {e}"))?;

    let core_libs = arduino_dir("directories.data")?.join("packages/arduino/hardware/avr").join(CORE_VERSION).join("libraries");
    let user_libs = arduino_dir("directories.user")?.join("libraries");

    let pack_path = cache_dir.join("compiler-pack.bin.lzma");
    if !pack_path.exists() {
        return Err("Run `cargo aide prepare-compiler` first.".into());
    }
    let pack = aide_core::pack::Pack::read(aide_core::lzma::unlzma(&read(&pack_path)?).map_err(|e| e.to_string())?)?;
    let manifest: PackManifest = serde_json::from_str(&pack.manifest_json).map_err(|e| format!("compiler pack manifest: {e}"))?;

    // Gather every candidate, check them all in one Node run, then keep those that compile.
    let mut builtin = builtin_examples(builtin_archive(&cache_dir)?);
    builtin.sort_by(|a, b| collate::compare(&a.category_dir, &b.category_dir).then_with(|| collate::compare(&a.example.name, &b.example.name)));
    // Starter sketches for the classroom's 37-in-1 sensor kit (named by the HW- numbers printed on the boards), kept in this repository.
    let kit = library_examples(&root.join("examples"), "SensorKit")?;
    let mut libraries = Vec::new();
    for lib in &manifest.libraries {
        let dir: PathBuf = if core_libs.join(&lib.name).exists() { core_libs.join(&lib.name) } else { user_libs.join(&lib.name) };
        libraries.push((lib, dir.clone(), library_examples(&dir, "examples")?));
    }

    let mut candidates: Vec<(String, &Example)> = Vec::new();
    candidates.extend(builtin.iter().map(|b| (b.category.clone(), &b.example)));
    candidates.extend(kit.iter().map(|e| ("Sensor Kit".to_string(), e)));
    for (lib, _, examples) in &libraries {
        candidates.extend(examples.iter().map(|e| (lib.display_name.clone(), e)));
    }
    println!("Compiling {} examples…", candidates.len());
    let ok = compiles(&root, &candidates.iter().map(|(_, e)| *e).collect::<Vec<_>>())?;
    let mut verdict: BTreeMap<*const Example, bool> = BTreeMap::new();
    let (mut kept, mut dropped) = (0, 0);
    for ((label, ex), ok) in candidates.iter().zip(ok) {
        verdict.insert(*ex as *const Example, ok);
        if ok {
            kept += 1;
        } else {
            dropped += 1;
            println!("  skip {label}/{} (doesn't compile for the Uno)", ex.name);
        }
    }
    let keep = |examples: &[Example]| -> Vec<Example> { examples.iter().filter(|e| verdict[&(*e as *const Example)]).cloned().collect() };

    let mut builtin_categories: Vec<Category> = Vec::new();
    for b in &builtin {
        if !verdict[&(&b.example as *const Example)] {
            continue;
        }
        match builtin_categories.last_mut() {
            Some(c) if c.category == b.category => c.examples.push(b.example.clone()),
            _ => builtin_categories.push(Category { category: b.category.clone(), examples: vec![b.example.clone()] }),
        }
    }
    let kit = if kit.is_empty() { vec![] } else { vec![Category { category: "37-in-1 Sensor Kit".into(), examples: keep(&kit) }] };

    let mut library_data = Vec::new();
    for (lib, dir, examples) in &libraries {
        let p = read_properties(dir)?;
        let get = |k: &str| p.get(k).cloned().unwrap_or_default();
        let license = library_license(&lib.name, dir, &licenses_dir, &library_licenses)?;
        // Headers to #include: the library's declared ones, else its top-level headers.
        let includes = match p.get("includes") {
            Some(s) if !s.is_empty() => s.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
            _ => lib.headers.clone(),
        };
        library_data.push(LibraryData {
            name: lib.name.clone(),
            display_name: lib.display_name.clone(),
            version: lib.version.clone(),
            author: get("author"),
            sentence: get("sentence"),
            paragraph: get("paragraph"),
            url: get("url"),
            license: license.license,
            license_note: license.note,
            license_texts: license.texts,
            shared_texts: license.shared,
            includes,
            examples: keep(examples),
        });
    }

    let data = ExamplesData {
        created_at: util::now_iso(),
        builtin_source: format!("arduino/arduino-examples {EXAMPLES_TAG} (CC0-1.0)"),
        kit,
        builtin: builtin_categories,
        libraries: library_data,
    };
    let json = serde_json::to_vec(&data).unwrap();
    let packed = compress(&json)?;
    write(&out_file, &packed)?;
    println!("\n{kept} examples kept, {dropped} skipped. {} KB -> {} KB compressed (build/cache/examples.json.lzma)", json.len() / 1024, packed.len() / 1024);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_license_comments_and_sections() {
        let src = "/* just code */\n/*\n * Copyright (c) 2020 Someone\n * MIT License\n */\nint x;";
        assert_eq!(license_comment(src).unwrap(), "Copyright (c) 2020 Someone\nMIT License");
        let doc = "= Lib =\n\n== License ==\nGPL 2.\nSee COPYING.\n\n== Usage ==\nx";
        assert_eq!(doc_section(doc, "License").unwrap(), "GPL 2.\nSee COPYING.");
        assert_eq!(doc_section(doc, "Missing"), None);
    }

    #[test]
    fn orders_example_files() {
        let f = |n: &str| File { name: n.into(), code: String::new() };
        let names: Vec<String> = order_files(vec![f("z.h"), f("Blink.ino"), f("a.ino")], "Blink").into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["Blink.ino", "a.ino", "z.h"]);
    }
}
