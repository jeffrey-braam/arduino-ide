//! Compiles a sketch with the WebAssembly GCC toolchain (cc1plus -> as -> ld -> objcopy).
//! The tools are Emscripten programs, so they run in JavaScript (the page's compiler worker, or
//! Node for the build scripts and tests); they're reached through the `Tools` trait. Each tool run
//! gets a fresh instance with an in-memory filesystem.

#![allow(async_fn_in_trait)]

use crate::collate;
use crate::elf::memory_usage;
use crate::intelhex::parse_intel_hex;
use crate::pack::Pack;
use crate::preprocess::{find_includes, preprocess_sketch, InoFile};
use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ops::Range;
use std::sync::OnceLock;

const DEFINES: [&str; 6] = ["-D__AVR_ATmega328P__", "-D__AVR_DEVICE_NAME__=atmega328p", "-DF_CPU=16000000L", "-DARDUINO=10607", "-DARDUINO_AVR_UNO", "-DARDUINO_ARCH_AVR"];
// Same as `avr-g++ -mmcu=atmega328p` passes to cc1plus with the Arduino platform flags (no -flto).
const CC1PLUS_FLAGS: [&str; 17] = [
    "-quiet", "-imultilib", "avr5", "-mn-flash=1", "-mno-skip-bug", "-mmcu=avr5", "-Os", "-Wno-error=narrowing", "-std=gnu++11", "-fpermissive", "-fno-exceptions",
    "-ffunction-sections", "-fdata-sections", "-fno-threadsafe-statics", "-fno-rtti", "-fno-enforce-eh-specs", "-fdiagnostics-color=never",
];
const SYSTEM_INCLUDES: [&str; 3] = ["/sysroot/gcc/include", "/sysroot/gcc/include-fixed", "/sysroot/avr/include"];

/// One Emscripten tool run: write input files, run main, read the output file.
pub trait ToolInstance {
    type Error;
    fn write_file(&mut self, path: &str, data: &[u8]) -> Result<(), Self::Error>;
    /// Runs the program; returns its exit status.
    fn call_main(&mut self, args: &[String]) -> Result<i32, Self::Error>;
    fn read_file(&mut self, path: &str) -> Option<Vec<u8>>;
    /// Lines the program printed (stdout and stderr).
    fn output(&mut self) -> Vec<String>;
}

pub trait Tools {
    type Error;
    type Instance: ToolInstance<Error = Self::Error>;
    /// A fresh instance of a tool: "cc1plus", "avr-as", "avr-ld" or "avr-objcopy".
    async fn instantiate(&mut self, tool: &str) -> Result<Self::Instance, Self::Error>;
    fn log(&mut self, message: &str);
    /// Milliseconds, for timings.
    fn now(&self) -> f64;
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CompileError {
    pub message: String,
    pub diagnostics: Vec<Diagnostic>,
    pub output: String,
}

#[derive(Debug)]
pub enum BuildError<E> {
    Compile(CompileError),
    /// A tool couldn't be started or crashed.
    Tool(E),
}

impl<E> From<E> for BuildError<E> {
    fn from(e: E) -> Self {
        BuildError::Tool(e)
    }
}

fn compile_error<T, E>(message: &str, diagnostics: Vec<Diagnostic>, output: String) -> Result<T, BuildError<E>> {
    Err(BuildError::Compile(CompileError { message: message.to_string(), diagnostics, output }))
}

#[derive(Debug, Clone, Serialize)]
pub struct Assembly {
    pub unit: String,
    pub text: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub compile_ms: f64,
    pub link_ms: f64,
    pub hex_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BuildResult {
    pub hex: String,
    #[serde(skip)]
    pub image: Vec<u8>,
    pub flash: u32,
    pub ram: u32,
    pub libraries: Vec<String>,
    pub warnings: Vec<Diagnostic>,
    pub output: String,
    pub assembly: Vec<Assembly>,
    pub timings: Timings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub include_dirs: Vec<String>,
    pub headers: Vec<String>,
    pub objects: Vec<String>,
    pub deps: Vec<String>,
}

#[derive(Deserialize)]
struct Manifest {
    libraries: Vec<Library>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SketchFile {
    pub name: String,
    pub code: String,
}

// cc1plus messages look like: Blink.ino:12:5: error: 'foo' was not declared in this scope
fn diag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$").unwrap())
}

/// Messages about the student's own files (not library internals), for editor markers.
pub fn parse_diagnostics(lines: &[String], file_names: &HashSet<&str>) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for l in lines {
        let Some(m) = diag_re().captures(l) else { continue };
        let file = m[1].rsplit('/').next().unwrap_or("");
        if file_names.contains(file) {
            let severity = if &m[4] == "fatal error" { "error" } else { &m[4] };
            out.push(Diagnostic { file: file.to_string(), line: m[2].parse().unwrap_or(0), column: m[3].parse().unwrap_or(0), severity: severity.to_string(), message: m[5].to_string() });
        }
    }
    out
}

/// A line of compiler output for the Output panel: CSS class, and the sketch location it's about.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OutputLine {
    pub text: String,
    pub class: &'static str,
    pub file: Option<String>,
    pub line: u32,
    pub column: u32,
}

pub fn output_lines(text: &str) -> Vec<OutputLine> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^([^:\s]+):(\d+):(\d+): (fatal error|error|warning|note):").unwrap());
    text.split('\n')
        .filter(|l| !l.trim().is_empty())
        .map(|raw| {
            let text = raw.replace("/build/sketch/", "");
            let m = re.captures(&text);
            let kind = m.as_ref().map_or("", |m| m.get(4).unwrap().as_str());
            let class = if kind.ends_with("error") { "error" } else if kind == "warning" { "warn" } else { "muted" };
            let (file, line, column) = match &m {
                Some(m) => (Some(m[1].to_string()), m[2].parse().unwrap_or(0), m[3].parse().unwrap_or(0)),
                None => (None, 0, 0),
            };
            OutputLine { text: text.clone(), class, file, line, column }
        })
        .collect()
}

fn has_ext(name: &str, exts: &[&str]) -> bool {
    let lower = name.to_ascii_lowercase();
    exts.iter().any(|e| lower.ends_with(&format!(".{e}")))
}
const INO: &[&str] = &["ino"];
const HEADER: &[&str] = &["h", "hh", "hpp", "hxx", "inc", "tpp"];
const CPP: &[&str] = &["cpp", "cc", "cxx"];

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

struct Run {
    status: i32,
    stderr: Vec<String>,
    output: Option<Vec<u8>>,
}

/// The compiler's files (from the pack) and the libraries it knows.
pub struct Toolchain {
    data: Vec<u8>,
    files: Vec<(String, Range<usize>)>,
    index: HashMap<String, usize>,
    manifest_json: String,
    libraries: Vec<Library>,
}

impl Toolchain {
    pub fn new(pack: Pack) -> Result<Toolchain, String> {
        let manifest: Manifest = serde_json::from_str(&pack.manifest_json).map_err(|e| format!("Compiler data is damaged ({e})"))?;
        let index = pack.files.iter().enumerate().map(|(i, (p, _))| (p.clone(), i)).collect();
        Ok(Toolchain { data: pack.data, files: pack.files, index, manifest_json: pack.manifest_json, libraries: manifest.libraries })
    }

    pub fn manifest_json(&self) -> &str {
        &self.manifest_json
    }

    pub fn file(&self, path: &str) -> Option<&[u8]> {
        self.index.get(path).map(|&i| &self.data[self.files[i].1.clone()])
    }

    fn files_under<'a>(&'a self, prefixes: &'a [&str]) -> impl Iterator<Item = (&'a str, &'a [u8])> + 'a {
        self.files.iter().filter(move |(p, _)| prefixes.iter().any(|pre| p.starts_with(pre))).map(|(p, r)| (p.as_str(), &self.data[r.clone()]))
    }

    /// Libraries needed by the sketch's #includes, plus their dependencies.
    pub fn resolve_libraries(&self, includes: &[String]) -> Vec<&Library> {
        let mut by_header: HashMap<&str, &Library> = HashMap::new();
        for lib in &self.libraries {
            for h in &lib.headers {
                by_header.entry(h.as_str()).or_insert(lib);
            }
        }
        fn add<'a>(lib: &'a Library, all: &'a [Library], picked: &mut Vec<&'a Library>) {
            if picked.iter().any(|l| l.name == lib.name) {
                return;
            }
            picked.push(lib);
            for d in &lib.deps {
                if let Some(dep) = all.iter().find(|l| &l.name == d) {
                    add(dep, all, picked);
                }
            }
        }
        let mut picked = Vec::new();
        for inc in includes {
            if let Some(lib) = by_header.get(base_name(inc)) {
                add(lib, &self.libraries, &mut picked);
            }
        }
        picked
    }

    async fn run<T: Tools>(&self, tools: &mut T, tool: &str, args: Vec<String>, inputs: &[(&str, &[u8])], output_path: &str) -> Result<Run, T::Error> {
        let mut inst = tools.instantiate(tool).await?;
        for (p, data) in inputs {
            inst.write_file(p, data)?;
        }
        let status = inst.call_main(&args)?;
        Ok(Run { status, stderr: inst.output(), output: inst.read_file(output_path) })
    }

    /// `files[0]` is the main .ino; other .ino tabs, .h and .cpp files may follow.
    pub async fn build<T: Tools>(&self, files: &[SketchFile], tools: &mut T, keep_assembly: bool) -> Result<BuildResult, BuildError<T::Error>> {
        let start = tools.now();
        let Some((main, rest)) = files.split_first() else {
            return compile_error("The sketch has no files.", vec![], String::new());
        };
        let unsupported: Vec<&str> = rest.iter().filter(|f| !has_ext(&f.name, INO) && !has_ext(&f.name, HEADER) && !has_ext(&f.name, CPP)).map(|f| f.name.as_str()).collect();
        if !unsupported.is_empty() {
            return compile_error(&format!("Can't compile {}: only .ino, .h and .cpp files are supported.", unsupported.join(", ")), vec![], String::new());
        }

        let mut other_inos: Vec<&SketchFile> = rest.iter().filter(|f| has_ext(&f.name, INO)).collect();
        other_inos.sort_by(|a, b| collate::compare(&a.name, &b.name));
        let inos: Vec<InoFile> = std::iter::once(main).chain(other_inos).map(|f| InoFile { name: &f.name, code: &f.code }).collect();
        let cpp_tabs: Vec<&SketchFile> = rest.iter().filter(|f| has_ext(&f.name, CPP)).collect();
        let names: HashSet<&str> = files.iter().map(|f| f.name.as_str()).collect();
        let cpp = preprocess_sketch(&inos).cpp;

        // A header the sketch has its own copy of (a tab) is used instead of a library, as in the
        // Arduino IDE, so that library isn't linked in.
        let own_files: HashSet<String> = files.iter().map(|f| f.name.to_lowercase()).collect();
        let includes: Vec<String> = files.iter().flat_map(|f| find_includes(&f.code)).filter(|inc| !own_files.contains(&base_name(inc).to_lowercase())).collect();
        let libs = self.resolve_libraries(&includes);
        if !libs.is_empty() {
            let list: Vec<String> = libs.iter().map(|l| format!("{} {}", l.display_name, l.version)).collect();
            tools.log(&format!("Using libraries: {}", list.join(", ")));
        }

        let mut include_args: Vec<String> = SYSTEM_INCLUDES.iter().flat_map(|d| ["-isystem".to_string(), d.to_string()]).collect();
        for d in ["/build/sketch", "/arduino/core", "/arduino/variant"].iter().copied().chain(libs.iter().flat_map(|l| l.include_dirs.iter().map(String::as_str))) {
            include_args.extend(["-I".to_string(), d.to_string()]);
        }
        let sketch_files: Vec<(String, &[u8])> = rest.iter().filter(|f| !has_ext(&f.name, INO)).map(|f| (format!("/build/sketch/{}", f.name), f.code.as_bytes())).collect();
        let mut inputs: Vec<(&str, &[u8])> = self.files_under(&["/sysroot/", "/arduino/", "/libraries/"]).collect();
        inputs.extend(sketch_files.iter().map(|(p, d)| (p.as_str(), *d)));

        // 1-2. Compile each translation unit to assembly, then assemble it.
        let mut units: Vec<(String, &[u8])> = vec![(format!("/build/sketch/{}.cpp", main.name), cpp.as_bytes())];
        units.extend(cpp_tabs.iter().map(|f| (format!("/build/sketch/{}", f.name), f.code.as_bytes())));
        let mut objects: Vec<(String, Vec<u8>)> = Vec::new();
        let mut assembly = Vec::new(); // kept only when asked for, to compare against the native compiler
        let mut diagnostics = Vec::new();
        let mut output: Vec<String> = Vec::new();
        let strings = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        for (i, (path, data)) in units.iter().enumerate() {
            let base = base_name(path).to_string();
            let mut args = strings(&CC1PLUS_FLAGS);
            args.extend(strings(&DEFINES));
            args.extend(include_args.iter().cloned());
            args.extend([path.clone(), "-dumpbase".into(), base.clone(), "-auxbase-strip".into(), "/build/out.s".into(), "-o".into(), "/build/out.s".into()]);
            let mut unit_inputs = inputs.clone();
            unit_inputs.push((path, data));
            let cc = self.run(tools, "cc1plus", args, &unit_inputs, "/build/out.s").await?;
            diagnostics.extend(parse_diagnostics(&cc.stderr, &names));
            output.extend(cc.stderr);
            let Some(asm) = cc.output.filter(|_| cc.status == 0) else {
                return compile_error("Compilation failed.", diagnostics, output.join("\n"));
            };

            let args = strings(&["-mmcu=avr5", "-mno-skip-bug", "-o", "/build/out.o", "/build/out.s"]);
            let r#as = self.run(tools, "avr-as", args, &[("/build/out.s", &asm)], "/build/out.o").await?;
            output.extend(r#as.stderr);
            let Some(obj) = r#as.output.filter(|_| r#as.status == 0) else {
                return compile_error("Assembling failed.", diagnostics, output.join("\n"));
            };
            objects.push((format!("/build/unit{i}.o"), obj));
            if keep_assembly {
                assembly.push(Assembly { unit: base, text: String::from_utf8_lossy(&asm).into_owned(), source: String::from_utf8_lossy(data).into_owned() });
            }
        }
        let compiled = tools.now();
        let warnings: Vec<Diagnostic> = diagnostics.iter().filter(|d| d.severity == "warning").cloned().collect();

        // 3. Link: same as `avr-gcc -mmcu=atmega328p -Wl,--gc-sections ... -lm`
        let lib_objects: Vec<&str> = libs.iter().flat_map(|l| l.objects.iter().map(String::as_str)).collect();
        let mut link_inputs: Vec<(&str, &[u8])> = objects.iter().map(|(p, d)| (p.as_str(), d.as_slice())).collect();
        link_inputs.extend(self.files_under(&["/libs/", "/ldscripts/"]));
        link_inputs.extend(lib_objects.iter().filter_map(|p| Some((*p, self.file(p)?))));
        let mut args = strings(&["-mavr5", "-Tdata", "0x800100", "-o", "/build/sketch.elf", "/libs/crtatmega328p.o", "-L/libs", "--gc-sections"]);
        args.extend(objects.iter().map(|(p, _)| p.clone()));
        args.extend(strings(&lib_objects));
        args.extend(strings(&["/libs/core.a", "-lm", "--start-group", "-lgcc", "-lm", "-lc", "-latmega328p", "--end-group"]));
        let ld = self.run(tools, "avr-ld", args, &link_inputs, "/build/sketch.elf").await?;
        output.extend(ld.stderr);
        let Some(elf) = ld.output.filter(|_| ld.status == 0) else {
            return compile_error("Linking failed.", diagnostics, output.join("\n"));
        };
        let linked = tools.now();

        // 4. Convert to Intel HEX
        let args = strings(&["-O", "ihex", "-R", ".eeprom", "/build/sketch.elf", "/build/sketch.hex"]);
        let oc = self.run(tools, "avr-objcopy", args, &[("/build/sketch.elf", &elf)], "/build/sketch.hex").await?;
        let Some(hex) = oc.output.filter(|_| oc.status == 0) else {
            return compile_error("Creating the .hex file failed.", vec![], oc.stderr.join("\n"));
        };
        let end = tools.now();

        let hex = String::from_utf8_lossy(&hex).into_owned();
        let usage = memory_usage(&elf).map_err(|e| BuildError::Compile(CompileError { message: e, ..Default::default() }))?;
        let image = parse_intel_hex(&hex).map_err(|e| BuildError::Compile(CompileError { message: e.0, ..Default::default() }))?;
        Ok(BuildResult {
            hex,
            image,
            flash: usage.flash,
            ram: usage.ram,
            libraries: libs.iter().map(|l| l.name.clone()).collect(),
            warnings,
            output: output.join("\n"),
            assembly,
            timings: Timings {
                compile_ms: (compiled - start).round(),
                link_ms: (linked - compiled).round(),
                hex_ms: (end - linked).round(),
                total_ms: (end - start).round(),
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack::write_pack;
    use crate::test_util::block_on;
    use std::cell::RefCell;
    use std::rc::Rc;

    fn toolchain() -> Toolchain {
        let manifest = serde_json::json!({ "libraries": [
            { "name": "OneWire", "displayName": "OneWire", "version": "2.3.8", "includeDirs": ["/libraries/OneWire"], "headers": ["OneWire.h"], "objects": ["/objects/OneWire/OneWire.cpp.o"], "deps": [] },
            { "name": "DallasTemperature", "displayName": "DallasTemperature", "version": "3.9.0", "includeDirs": ["/libraries/DallasTemperature"], "headers": ["DallasTemperature.h"], "objects": ["/objects/DallasTemperature/DallasTemperature.cpp.o"], "deps": ["OneWire"] },
            { "name": "LiquidCrystal", "displayName": "LiquidCrystal", "version": "1.0.7", "includeDirs": ["/libraries/LiquidCrystal"], "headers": ["LiquidCrystal.h"], "objects": [], "deps": [] }
        ]});
        let files: Vec<(String, Vec<u8>)> = ["/sysroot/avr/include/avr/io.h", "/arduino/core/Arduino.h", "/libraries/OneWire/OneWire.h", "/libs/core.a", "/ldscripts/avr5.x", "/objects/OneWire/OneWire.cpp.o", "/objects/DallasTemperature/DallasTemperature.cpp.o", "/tools/cc1plus.wasm"]
            .iter()
            .map(|p| (p.to_string(), p.as_bytes().to_vec()))
            .collect();
        Toolchain::new(Pack::read(write_pack(&files, &manifest)).unwrap()).unwrap()
    }

    // Fake tools: record each run, succeed unless told to fail, and produce plausible outputs.
    #[derive(Default)]
    struct FakeTools {
        runs: Rc<RefCell<Vec<(String, Vec<String>, Vec<String>)>>>, // tool, args, input paths
        logs: Vec<String>,
        fail: Option<&'static str>,
        cc_messages: Vec<String>,
    }

    struct FakeInstance {
        tool: String,
        args: Vec<String>,
        inputs: Vec<String>,
        fail: bool,
        messages: Vec<String>,
        runs: Rc<RefCell<Vec<(String, Vec<String>, Vec<String>)>>>,
    }

    const HEX: &str = ":100000000C9434000C943E000C943E000C943E0082\n:00000001FF\n";

    impl ToolInstance for FakeInstance {
        type Error = String;
        fn write_file(&mut self, path: &str, _data: &[u8]) -> Result<(), String> {
            self.inputs.push(path.to_string());
            Ok(())
        }
        fn call_main(&mut self, args: &[String]) -> Result<i32, String> {
            self.args = args.to_vec();
            self.runs.borrow_mut().push((self.tool.clone(), self.args.clone(), self.inputs.clone()));
            Ok(if self.fail { 1 } else { 0 })
        }
        fn read_file(&mut self, _path: &str) -> Option<Vec<u8>> {
            if self.fail {
                return None;
            }
            Some(match self.tool.as_str() {
                "avr-ld" => elf_with_text(16),
                "avr-objcopy" => HEX.as_bytes().to_vec(),
                _ => b"output".to_vec(),
            })
        }
        fn output(&mut self) -> Vec<String> {
            self.messages.clone()
        }
    }

    fn elf_with_text(size: u32) -> Vec<u8> {
        let names = b"\0.text\0.shstrtab\0";
        let shoff = 52 + names.len();
        let mut b = vec![0u8; shoff + 3 * 40];
        b[..4].copy_from_slice(b"\x7fELF");
        b[0x20..0x24].copy_from_slice(&(shoff as u32).to_le_bytes());
        b[0x2e..0x30].copy_from_slice(&40u16.to_le_bytes());
        b[0x30..0x32].copy_from_slice(&3u16.to_le_bytes());
        b[0x32..0x34].copy_from_slice(&2u16.to_le_bytes());
        b[52..shoff].copy_from_slice(names);
        for (i, (name, off, sz)) in [(0u32, 0u32, 0u32), (1, 0, size), (7, 52, names.len() as u32)].into_iter().enumerate() {
            let o = shoff + i * 40;
            b[o..o + 4].copy_from_slice(&name.to_le_bytes());
            b[o + 16..o + 20].copy_from_slice(&off.to_le_bytes());
            b[o + 20..o + 24].copy_from_slice(&sz.to_le_bytes());
        }
        b
    }

    impl Tools for FakeTools {
        type Error = String;
        type Instance = FakeInstance;
        async fn instantiate(&mut self, tool: &str) -> Result<FakeInstance, String> {
            let fail = self.fail == Some(tool);
            let messages = if tool == "cc1plus" { self.cc_messages.clone() } else { vec![] };
            Ok(FakeInstance { tool: tool.into(), args: vec![], inputs: vec![], fail, messages, runs: self.runs.clone() })
        }
        fn log(&mut self, message: &str) {
            self.logs.push(message.into());
        }
        fn now(&self) -> f64 {
            0.0
        }
    }

    fn sketch(files: &[(&str, &str)]) -> Vec<SketchFile> {
        files.iter().map(|(n, c)| SketchFile { name: n.to_string(), code: c.to_string() }).collect()
    }

    #[test]
    fn runs_the_four_tools_and_reports_sizes() {
        let tc = toolchain();
        let mut tools = FakeTools::default();
        let r = block_on(tc.build(&sketch(&[("Blink.ino", "void setup() {}\nvoid loop() {}\n")]), &mut tools, false)).unwrap();
        let runs = tools.runs.borrow();
        let order: Vec<&str> = runs.iter().map(|(t, _, _)| t.as_str()).collect();
        assert_eq!(order, ["cc1plus", "avr-as", "avr-ld", "avr-objcopy"]);
        assert_eq!((r.flash, r.image.len()), (16, 16));
        let (_, cc_args, cc_inputs) = &runs[0];
        assert!(cc_args.contains(&"/build/sketch/Blink.ino.cpp".to_string()));
        assert!(cc_inputs.contains(&"/arduino/core/Arduino.h".to_string()));
        assert!(!cc_inputs.contains(&"/libs/core.a".to_string()));
        let (_, ld_args, ld_inputs) = &runs[2];
        assert!(ld_args.contains(&"/build/unit0.o".to_string()));
        assert!(ld_inputs.contains(&"/ldscripts/avr5.x".to_string()));
    }

    #[test]
    fn links_the_libraries_a_sketch_includes_with_their_dependencies() {
        let tc = toolchain();
        let mut tools = FakeTools::default();
        let r = block_on(tc.build(&sketch(&[("T.ino", "#include <DallasTemperature.h>\nvoid setup() {}\nvoid loop() {}\n")]), &mut tools, false)).unwrap();
        assert_eq!(r.libraries, ["DallasTemperature", "OneWire"]);
        assert_eq!(tools.logs, ["Using libraries: DallasTemperature 3.9.0, OneWire 2.3.8"]);
        assert!(tools.runs.borrow()[2].1.contains(&"/objects/OneWire/OneWire.cpp.o".to_string()));
    }

    #[test]
    fn uses_the_sketchs_own_copy_of_a_header_instead_of_the_library() {
        let tc = toolchain();
        let mut tools = FakeTools::default();
        let files = sketch(&[("Lcd.ino", "#include \"LiquidCrystal.h\"\nvoid setup() { lcdInit(); }\nvoid loop() {}\n"), ("LiquidCrystal.h", "void lcdInit();\n"), ("LiquidCrystal.cpp", "#include \"LiquidCrystal.h\"\nvoid lcdInit() {}\n")]);
        let r = block_on(tc.build(&files, &mut tools, false)).unwrap();
        assert!(r.libraries.is_empty());
        // Two translation units: the sketch and the .cpp tab.
        assert_eq!(tools.runs.borrow().iter().filter(|(t, _, _)| t == "cc1plus").count(), 2);
    }

    #[test]
    fn reports_errors_at_the_students_line() {
        let tc = toolchain();
        let mut tools = FakeTools { fail: Some("cc1plus"), cc_messages: vec!["/build/sketch/HasError.ino:7:3: error: 'x' was not declared in this scope".into(), "/arduino/core/Arduino.h:1:1: warning: lib".into()], ..Default::default() };
        let Err(BuildError::Compile(e)) = block_on(tc.build(&sketch(&[("HasError.ino", "void setup() {}\n")]), &mut tools, false)) else { panic!("expected a compile error") };
        assert_eq!(e.message, "Compilation failed.");
        assert_eq!(e.diagnostics, [Diagnostic { file: "HasError.ino".into(), line: 7, column: 3, severity: "error".into(), message: "'x' was not declared in this scope".into() }]);
        assert!(e.output.contains("Arduino.h"));
    }

    #[test]
    fn rejects_unsupported_files() {
        let tc = toolchain();
        let Err(BuildError::Compile(e)) = block_on(tc.build(&sketch(&[("S.ino", ""), ("notes.txt", "")]), &mut FakeTools::default(), false)) else { panic!() };
        assert_eq!(e.message, "Can't compile notes.txt: only .ino, .h and .cpp files are supported.");
    }

    #[test]
    fn classifies_output_lines() {
        let lines = output_lines("/build/sketch/S.ino:3:5: error: oops\n\nIn file included from x\nS.ino:4:1: warning: hmm\n");
        assert_eq!(lines.len(), 3);
        assert_eq!((lines[0].text.as_str(), lines[0].class, lines[0].file.as_deref(), lines[0].line), ("S.ino:3:5: error: oops", "error", Some("S.ino"), 3));
        assert_eq!((lines[1].class, lines[1].file.as_deref()), ("muted", None));
        assert_eq!(lines[2].class, "warn");
    }
}
