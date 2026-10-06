//! Builds the compiler pack embedded in the IDE: WebAssembly GCC tools, headers, and the Arduino
//! core + bundled libraries precompiled with the native Arduino toolchain (same GCC 7.3.0).
//!
//! Needs arduino-cli with `arduino:avr@1.8.8` and the libraries below installed.
//! Output: build/cache/compiler-pack.bin.lzma

use crate::util::{self, arduino_dir, compress, file_name, list_dir, posix, read, read_text, root, exec, write, Result};
use regex_lite::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CORE_VERSION: &str = "1.8.8";
const GCC_VERSION: &str = "7.3.0-atmel3.6.1-arduino7";
const TOOLS: [&str; 4] = ["cc1plus", "avr-as", "avr-ld", "avr-objcopy"];

/// Libraries students can #include. "core" = bundled with the AVR core; "user" = installed with
/// `arduino-cli lib install`.
const LIBRARIES: [(&str, &str); 14] = [
    ("Wire", "core"),
    ("SPI", "core"),
    ("SoftwareSerial", "core"),
    ("EEPROM", "core"),
    ("Servo", "user"),
    ("OneWire", "user"),
    ("DallasTemperature", "user"),
    ("DHT_sensor_library", "user"),
    ("Adafruit_Unified_Sensor", "user"),
    ("IRremote", "user"),
    ("PulseSensor_Playground", "user"),
    ("Encoder", "user"),
    ("LiquidCrystal", "user"),
    ("CapacitiveSensor", "user"),
];

fn is_header(p: &Path) -> bool {
    let n = file_name(p).to_ascii_lowercase();
    ["h", "hh", "hpp", "hxx", "inc", "tpp", "ipp"].iter().any(|e| n.ends_with(&format!(".{e}")))
}

fn is_source(p: &Path) -> bool {
    let n = file_name(p);
    ["c", "cpp", "cc", "cxx", "S"].iter().any(|e| n.ends_with(&format!(".{e}")))
}

fn walk(dir: &Path, filter: &dyn Fn(&Path) -> bool) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for p in list_dir(dir)? {
        let name = file_name(&p);
        if p.is_dir() {
            if name.starts_with('.') || ["examples", "extras", "test", "tests", "docs"].contains(&name.as_str()) {
                continue;
            }
            out.extend(walk(&p, filter)?);
        } else if filter(&p) {
            out.push(p);
        }
    }
    Ok(out)
}

fn rel(base: &Path, p: &Path) -> String {
    posix(p.strip_prefix(base).unwrap_or(p))
}

// Flags from arduino:avr:uno platform.txt, minus -g/-flto/-MMD: debug info isn't needed and
// link-time optimisation needs the LTO plugin, which the WebAssembly linker doesn't have.
const DEFINES: [&str; 5] = ["-mmcu=atmega328p", "-DF_CPU=16000000L", "-DARDUINO=10607", "-DARDUINO_AVR_UNO", "-DARDUINO_ARCH_AVR"];
const CPP_FLAGS: [&str; 10] = ["-c", "-Os", "-w", "-std=gnu++11", "-fpermissive", "-fno-exceptions", "-ffunction-sections", "-fdata-sections", "-fno-threadsafe-statics", "-Wno-error=narrowing"];
const C_FLAGS: [&str; 6] = ["-c", "-Os", "-w", "-std=gnu11", "-ffunction-sections", "-fdata-sections"];
const S_FLAGS: [&str; 3] = ["-c", "-x", "assembler-with-cpp"];

struct Gcc {
    bin: PathBuf,
}

impl Gcc {
    fn tool(&self, name: &str) -> Command {
        Command::new(self.bin.join(format!("avr-{name}{}", std::env::consts::EXE_SUFFIX)))
    }

    fn compile(&self, src: &Path, obj: &Path, includes: &[PathBuf]) -> Result {
        std::fs::create_dir_all(obj.parent().unwrap()).map_err(|e| e.to_string())?;
        let name = file_name(src);
        let (tool, flags): (&str, &[&str]) = if name.ends_with(".S") {
            ("gcc", &S_FLAGS)
        } else if name.ends_with(".c") {
            ("gcc", &C_FLAGS)
        } else {
            ("g++", &CPP_FLAGS)
        };
        let mut cmd = self.tool(tool);
        cmd.args(flags).args(DEFINES);
        for d in includes {
            cmd.arg("-I").arg(d);
        }
        exec(cmd.arg(src).arg("-o").arg(obj).stdin(Stdio::null()))
    }
}

struct LibraryInfo {
    name: String,
    display_name: String,
    version: String,
    license: String,
    dir: PathBuf,
    include_dir: PathBuf,
    utility_dir: Option<PathBuf>,
    sources: Vec<PathBuf>,
    headers: Vec<PathBuf>,
    top_headers: Vec<String>,
}

/// The value of `key=` in a library.properties file.
fn property(props: &str, key: &str) -> Option<String> {
    props.lines().find_map(|l| l.strip_prefix(key).and_then(|r| r.strip_prefix('=')).map(|v| v.trim().to_string()))
}

fn describe_library(name: &str, where_: &str, hw_dir: &Path, user_dir: &Path) -> Result<LibraryInfo> {
    let dir = if where_ == "core" { hw_dir.join("libraries").join(name) } else { user_dir.join("libraries").join(name) };
    if !dir.exists() {
        return Err(format!("Library {name} not found at {}. Install it with arduino-cli lib install.", dir.display()));
    }
    let props_file = dir.join("library.properties");
    let props = if props_file.exists() { read_text(&props_file)? } else { String::new() };
    let prop = |k: &str| property(&props, k).filter(|v| !v.is_empty());
    let has_src = dir.join("src").exists();
    let include_dir = if has_src { dir.join("src") } else { dir.clone() };
    let utility = dir.join("utility");
    // Legacy layout: sources in the root and utility/; 1.5 layout: everything under src/.
    let sources = if has_src {
        walk(&include_dir, &is_source)?
    } else {
        let mut v: Vec<PathBuf> = list_dir(&dir)?;
        if utility.exists() {
            v.extend(walk(&utility, &|_| true)?);
        }
        v.into_iter().filter(|p| is_source(p) && p.is_file()).collect()
    };
    let headers = walk(&include_dir, &is_header)?;
    let top_headers = list_dir(&include_dir)?.into_iter().filter(|p| is_header(p)).map(|p| file_name(&p)).collect();
    Ok(LibraryInfo {
        name: name.to_string(),
        display_name: prop("name").unwrap_or_else(|| name.to_string()),
        version: prop("version").unwrap_or_default(),
        license: prop("license").unwrap_or_default(),
        utility_dir: (!has_src && utility.exists()).then_some(utility),
        dir,
        include_dir,
        sources,
        headers,
        top_headers,
    })
}

fn includes_of(file: &Path, re: &Regex) -> Result<Vec<String>> {
    let text = read_text(file)?;
    Ok(re.captures_iter(&text).map(|m| m[1].rsplit(['/', '\\']).next().unwrap_or("").to_string()).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryEntry {
    name: String,
    display_name: String,
    version: String,
    license: String,
    include_dirs: Vec<String>,
    headers: Vec<String>,
    objects: Vec<String>,
    deps: Vec<String>,
}

#[derive(Serialize)]
struct NameVersion {
    name: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    created_at: String,
    core: NameVersion,
    gcc: &'static str,
    tools: &'static str,
    libraries: Vec<LibraryEntry>,
}

/// Files in pack order; adding a path again replaces its data in place.
#[derive(Default)]
struct Files {
    list: Vec<(String, Vec<u8>)>,
    index: HashMap<String, usize>,
}

impl Files {
    fn add(&mut self, vpath: String, data: Vec<u8>) {
        match self.index.get(&vpath) {
            Some(&i) => self.list[i].1 = data,
            None => {
                self.index.insert(vpath.clone(), self.list.len());
                self.list.push((vpath, data));
            }
        }
    }

    fn add_tree(&mut self, host_dir: &Path, vdir: &str, filter: &dyn Fn(&Path) -> bool) -> Result {
        for f in walk(host_dir, filter)? {
            self.add(format!("{vdir}/{}", rel(host_dir, &f)), read(&f)?);
        }
        Ok(())
    }

    fn size_of(&self, prefix: &str) -> usize {
        self.list.iter().filter(|(p, _)| p.starts_with(prefix)).map(|(_, d)| d.len()).sum()
    }
}

pub fn run() -> Result {
    let root = root();
    let out_file = root.join("build/cache/compiler-pack.bin.lzma");
    let work_dir = root.join("build/cache/objects");
    let tools_dir = root.join("toolchain/out"); // built from source by toolchain/build.sh

    let data_dir = arduino_dir("directories.data")?;
    let user_dir = arduino_dir("directories.user")?;
    let pkg_dir = data_dir.join("packages/arduino");
    let hw_dir = pkg_dir.join("hardware/avr").join(CORE_VERSION);
    let gcc_dir = pkg_dir.join("tools/avr-gcc").join(GCC_VERSION);
    let gcc = Gcc { bin: gcc_dir.join("bin") };
    for p in [&hw_dir, &gcc_dir] {
        if !p.exists() {
            return Err(format!("Missing {}", p.display()));
        }
    }
    for t in TOOLS {
        if !tools_dir.join(format!("{t}.wasm")).exists() {
            return Err(format!("Missing toolchain/out/{t}.wasm. Build the tools with toolchain/build.sh (Linux or WSL)."));
        }
    }

    println!("Arduino data dir: {}", data_dir.display());
    let _ = std::fs::remove_dir_all(&work_dir);
    let mut files = Files::default();

    // Toolchain headers. avr-libc has a 28 MB register header per chip (avr/io*.h); only the Uno's
    // ATmega328P one is kept. Add more here if other boards are supported.
    files.add_tree(&gcc_dir.join("avr/include"), "/sysroot/avr/include", &|p: &Path| {
        let base = file_name(p);
        let in_avr = p.parent().map(file_name).as_deref() == Some("avr");
        let device_header = in_avr && base.starts_with("io") && base.ends_with(".h") && base.len() > 4;
        is_header(p) && (!device_header || base == "io.h" || base == "iom328p.h")
    })?;
    files.add_tree(&gcc_dir.join("lib/gcc/avr/7.3.0/include"), "/sysroot/gcc/include", &is_header)?;
    files.add_tree(&gcc_dir.join("lib/gcc/avr/7.3.0/include-fixed"), "/sysroot/gcc/include-fixed", &is_header)?;

    // Core + variant headers
    let core_dir = hw_dir.join("cores/arduino");
    let variant_dir = hw_dir.join("variants/standard");
    files.add_tree(&core_dir, "/arduino/core", &is_header)?;
    files.add_tree(&variant_dir, "/arduino/variant", &is_header)?;

    // Libraries: headers into the pack, sources precompiled to objects
    let libs = LIBRARIES.iter().map(|(n, w)| describe_library(n, w, &hw_dir, &user_dir)).collect::<Result<Vec<_>>>()?;
    let mut all_include_dirs = vec![core_dir.clone(), variant_dir.clone()];
    for l in &libs {
        all_include_dirs.push(l.include_dir.clone());
        all_include_dirs.extend(l.utility_dir.clone());
    }
    let mut header_owner: HashMap<&str, &str> = HashMap::new();
    for l in &libs {
        for h in &l.top_headers {
            header_owner.entry(h).or_insert(&l.name);
        }
    }
    let include_re = Regex::new(r#"(?m)^\s*#\s*include\s*[<"]([^>"]+)[>"]"#).unwrap();

    let mut lib_index = Vec::new();
    for l in &libs {
        let vdir = format!("/libraries/{}", l.name);
        for h in &l.headers {
            files.add(format!("{vdir}/{}", rel(&l.include_dir, h)), read(h)?);
        }
        if let Some(u) = &l.utility_dir {
            for h in walk(u, &is_header)? {
                files.add(format!("{vdir}/utility/{}", rel(u, &h)), read(&h)?);
            }
        }

        let mut objects = Vec::new();
        for src in &l.sources {
            let flat = rel(&l.dir, src).replace('/', "_");
            let obj = work_dir.join("libraries").join(&l.name).join(format!("{flat}.o"));
            gcc.compile(src, &obj, &all_include_dirs)?;
            let vobj = format!("/objects/{}/{flat}.o", l.name);
            files.add(vobj.clone(), read(&obj)?);
            objects.push(vobj);
        }
        // Dependencies: other bundled libraries whose headers this library includes.
        let mut deps: Vec<String> = Vec::new();
        for f in l.sources.iter().chain(&l.headers) {
            for inc in includes_of(f, &include_re)? {
                if let Some(owner) = header_owner.get(inc.as_str()) {
                    if *owner != l.name && !deps.iter().any(|d| d == owner) {
                        deps.push(owner.to_string());
                    }
                }
            }
        }
        println!(
            "  {} {}: {} sources, {} headers{}",
            l.display_name,
            l.version,
            l.sources.len(),
            l.headers.len(),
            if deps.is_empty() { String::new() } else { format!(", needs {}", deps.join(", ")) }
        );
        let mut include_dirs = vec![vdir.clone()];
        if l.utility_dir.is_some() {
            include_dirs.push(format!("{vdir}/utility"));
        }
        lib_index.push(LibraryEntry {
            name: l.name.clone(),
            display_name: l.display_name.clone(),
            version: l.version.clone(),
            license: l.license.clone(),
            include_dirs,
            headers: l.top_headers.clone(),
            objects,
            deps,
        });
    }

    // Core: compiled into an archive so the linker only pulls in what the sketch uses
    // (e.g. Tone.o and its timer interrupt only when tone() is called), as the Arduino IDE does.
    let mut core_objs = Vec::new();
    for src in walk(&core_dir, &is_source)? {
        let obj = work_dir.join("core").join(format!("{}.o", rel(&core_dir, &src).replace('/', "_")));
        gcc.compile(&src, &obj, &[core_dir.clone(), variant_dir.clone()])?;
        core_objs.push(obj);
    }
    let core_a = work_dir.join("core.a");
    exec(gcc.tool("gcc-ar").arg("rcs").arg(&core_a).args(&core_objs))?;
    files.add("/libs/core.a".into(), read(&core_a)?);
    println!("  core {CORE_VERSION}: {} objects", core_objs.len());

    // Link inputs: C runtime, avr-libc, libgcc (debug info stripped to save space)
    let avr5 = gcc_dir.join("avr/lib/avr5");
    for f in ["crtatmega328p.o", "libc.a", "libm.a", "libatmega328p.a"] {
        files.add(format!("/libs/{f}"), read(&avr5.join(f))?);
    }
    let libgcc = work_dir.join("libgcc.a");
    std::fs::copy(gcc_dir.join("lib/gcc/avr/7.3.0/avr5/libgcc.a"), &libgcc).map_err(|e| format!("libgcc.a: {e}"))?;
    exec(gcc.tool("strip").arg("-g").arg(&libgcc))?;
    files.add("/libs/libgcc.a".into(), read(&libgcc)?);
    // Linker scripts generated by the same binutils build as the WebAssembly ld.
    for f in list_dir(&tools_dir.join("ldscripts"))? {
        files.add(format!("/ldscripts/{}", file_name(&f)), read(&f)?);
    }

    // WebAssembly tools (their exact sources are listed in the About tab, from SOURCES.md)
    for t in TOOLS {
        files.add(format!("/tools/{t}.wasm"), read(&tools_dir.join(format!("{t}.wasm")))?);
    }

    let manifest = Manifest {
        created_at: util::now_iso(),
        core: NameVersion { name: "Arduino AVR Boards", version: CORE_VERSION },
        gcc: GCC_VERSION,
        tools: "GCC 7.3.0 (Arduino patches) and binutils 2.42, built from source by toolchain/build.sh",
        libraries: lib_index,
    };
    let pack = aide_core::pack::write_pack(&files.list, &manifest);
    let packed = compress(&pack)?;
    write(&out_file, &packed)?;
    let _ = std::fs::remove_dir_all(&work_dir); // intermediate objects, now in the pack

    println!("\n{} files, {} raw -> {} compressed (build/cache/compiler-pack.bin.lzma)", files.list.len(), util::mb(pack.len()), util::mb(packed.len()));
    for p in ["/tools", "/sysroot", "/arduino", "/libraries", "/objects", "/libs"] {
        println!("  {p:<11} {}", util::mb(files.size_of(p)));
    }
    Ok(())
}
