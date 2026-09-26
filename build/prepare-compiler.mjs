// Builds the compiler pack embedded in the IDE: WebAssembly GCC tools, headers, and the Arduino
// core + bundled libraries precompiled with the native Arduino toolchain (same GCC 7.3.0).
//
// Needs arduino-cli with `arduino:avr@1.8.8` and the libraries below installed.
// Output: build/cache/compiler-pack.bin.gz
// Usage: node build/prepare-compiler.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { writePack } from "../src/compiler/pack.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "build/cache/compiler-pack.bin.gz");
const workDir = path.join(root, "build/cache/objects");
const toolsDir = path.join(root, "toolchain/out"); // built from source by toolchain/build.sh

const CORE_VERSION = "1.8.8";
const GCC_VERSION = "7.3.0-atmel3.6.1-arduino7";
const exe = process.platform === "win32" ? ".exe" : "";

// Libraries students can #include. `where: "core"` = bundled with the AVR core; "user" = installed
// with `arduino-cli lib install`.
const LIBRARIES = [
  { name: "Wire", where: "core" },
  { name: "SPI", where: "core" },
  { name: "SoftwareSerial", where: "core" },
  { name: "EEPROM", where: "core" },
  { name: "Servo", where: "user" },
  { name: "OneWire", where: "user" },
  { name: "DallasTemperature", where: "user" },
  { name: "DHT_sensor_library", where: "user" },
  { name: "Adafruit_Unified_Sensor", where: "user" },
  { name: "IRremote", where: "user" },
  { name: "PulseSensor_Playground", where: "user" },
  { name: "Encoder", where: "user" },
];

const HEADER_EXT = /\.(h|hh|hpp|hxx|inc|tpp|ipp)$/i;
const SOURCE_EXT = /\.(c|cpp|cc|cxx|S)$/;

// ---------- Locate the Arduino installation ----------
function arduinoDir(key) {
  const cli = process.env.ARDUINO_CLI || (process.platform === "win32" ? "C:/Program Files/Arduino CLI/arduino-cli.exe" : "arduino-cli");
  return execFileSync(cli, ["config", "get", key], { encoding: "utf8" }).trim();
}
const dataDir = arduinoDir("directories.data");
const userDir = arduinoDir("directories.user");
const pkgDir = path.join(dataDir, "packages/arduino");
const hwDir = path.join(pkgDir, "hardware/avr", CORE_VERSION);
const gccDir = path.join(pkgDir, "tools/avr-gcc", GCC_VERSION);
const bin = (tool) => path.join(gccDir, "bin", "avr-" + tool + exe);

for (const p of [hwDir, gccDir]) if (!fs.existsSync(p)) throw new Error("Missing " + p);
for (const t of ["cc1plus", "avr-as", "avr-ld", "avr-objcopy"])
  if (!fs.existsSync(path.join(toolsDir, t + ".wasm"))) throw new Error(`Missing toolchain/out/${t}.wasm. Build the tools with toolchain/build.sh (Linux or WSL).`);

// ---------- Helpers ----------
function walk(dir, filter = () => true) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith(".") || ["examples", "extras", "test", "tests", "docs"].includes(e.name)) continue;
      out.push(...walk(p, filter));
    } else if (filter(p)) out.push(p);
  }
  return out;
}
const posix = (p) => p.split(path.sep).join("/");

// Flags from arduino:avr:uno platform.txt, minus -g/-flto/-MMD: debug info isn't needed and
// link-time optimisation needs the LTO plugin, which the WebAssembly linker doesn't have.
const DEFINES = ["-mmcu=atmega328p", "-DF_CPU=16000000L", "-DARDUINO=10607", "-DARDUINO_AVR_UNO", "-DARDUINO_ARCH_AVR"];
const CPP_FLAGS = ["-c", "-Os", "-w", "-std=gnu++11", "-fpermissive", "-fno-exceptions", "-ffunction-sections", "-fdata-sections", "-fno-threadsafe-statics", "-Wno-error=narrowing", ...DEFINES];
const C_FLAGS = ["-c", "-Os", "-w", "-std=gnu11", "-ffunction-sections", "-fdata-sections", ...DEFINES];
const S_FLAGS = ["-c", "-x", "assembler-with-cpp", ...DEFINES];

function compile(src, obj, includes) {
  fs.mkdirSync(path.dirname(obj), { recursive: true });
  const inc = includes.flatMap((d) => ["-I", d]);
  const [tool, flags] = src.endsWith(".S") ? ["gcc", S_FLAGS] : src.endsWith(".c") ? ["gcc", C_FLAGS] : ["g++", CPP_FLAGS];
  execFileSync(bin(tool), [...flags, ...inc, src, "-o", obj], { stdio: ["ignore", "inherit", "inherit"] });
}

// ---------- Libraries ----------
function describeLibrary({ name, where }) {
  const dir = where === "core" ? path.join(hwDir, "libraries", name) : path.join(userDir, "libraries", name);
  if (!fs.existsSync(dir)) throw new Error(`Library ${name} not found at ${dir}. Install it with arduino-cli lib install.`);
  const props = fs.existsSync(path.join(dir, "library.properties")) ? fs.readFileSync(path.join(dir, "library.properties"), "utf8") : "";
  const prop = (k) => (props.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
  const hasSrc = fs.existsSync(path.join(dir, "src"));
  const includeDir = hasSrc ? path.join(dir, "src") : dir;
  // Legacy layout: sources in the root and utility/; 1.5 layout: everything under src/.
  const sources = hasSrc
    ? walk(includeDir, (p) => SOURCE_EXT.test(p))
    : [...fs.readdirSync(dir).map((f) => path.join(dir, f)), ...(fs.existsSync(path.join(dir, "utility")) ? walk(path.join(dir, "utility")) : [])].filter(
        (p) => SOURCE_EXT.test(p) && fs.statSync(p).isFile(),
      );
  const headers = walk(includeDir, (p) => HEADER_EXT.test(p));
  const topHeaders = fs.readdirSync(includeDir).filter((f) => HEADER_EXT.test(f));
  return {
    name,
    displayName: prop("name") || name,
    version: prop("version") || "",
    license: prop("license") || "",
    dir,
    includeDir,
    utilityDir: !hasSrc && fs.existsSync(path.join(dir, "utility")) ? path.join(dir, "utility") : null,
    sources,
    headers,
    topHeaders,
  };
}

function includesOf(file) {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)].map((m) => path.basename(m[1]));
}

// ---------- Main ----------
console.log("Arduino data dir:", dataDir);
fs.rmSync(workDir, { recursive: true, force: true });
const files = new Map(); // virtual path -> Uint8Array
const add = (vpath, data) => files.set(vpath, data instanceof Uint8Array ? data : new Uint8Array(data));
const addTree = (hostDir, vdir, filter) => {
  for (const f of walk(hostDir, filter)) add(vdir + "/" + posix(path.relative(hostDir, f)), fs.readFileSync(f));
};

// Toolchain headers. avr-libc has a 28 MB register header per chip (avr/io*.h); only the Uno's
// ATmega328P one is kept. Add more here if other boards are supported.
const KEEP_IO_HEADERS = new Set(["io.h", "iom328p.h"]);
addTree(path.join(gccDir, "avr/include"), "/sysroot/avr/include", (p) => {
  const base = path.basename(p);
  const isDeviceHeader = path.basename(path.dirname(p)) === "avr" && /^io.+\.h$/.test(base);
  return HEADER_EXT.test(p) && (!isDeviceHeader || KEEP_IO_HEADERS.has(base));
});
addTree(path.join(gccDir, "lib/gcc/avr/7.3.0/include"), "/sysroot/gcc/include", (p) => HEADER_EXT.test(p));
addTree(path.join(gccDir, "lib/gcc/avr/7.3.0/include-fixed"), "/sysroot/gcc/include-fixed", (p) => HEADER_EXT.test(p));

// Core + variant headers
const coreDir = path.join(hwDir, "cores/arduino");
const variantDir = path.join(hwDir, "variants/standard");
addTree(coreDir, "/arduino/core", (p) => HEADER_EXT.test(p));
addTree(variantDir, "/arduino/variant", (p) => HEADER_EXT.test(p));

// Libraries: headers into the pack, sources precompiled to objects
const libs = LIBRARIES.map(describeLibrary);
const allIncludeDirs = [coreDir, variantDir, ...libs.flatMap((l) => [l.includeDir, l.utilityDir].filter(Boolean))];
const headerOwner = new Map();
for (const l of libs) for (const h of l.topHeaders) if (!headerOwner.has(h)) headerOwner.set(h, l.name);

const libIndex = [];
for (const l of libs) {
  const vdir = "/libraries/" + l.name;
  for (const h of l.headers) add(vdir + "/" + posix(path.relative(l.includeDir, h)), fs.readFileSync(h));
  if (l.utilityDir) for (const h of walk(l.utilityDir, (p) => HEADER_EXT.test(p))) add(vdir + "/utility/" + posix(path.relative(l.utilityDir, h)), fs.readFileSync(h));

  const objects = [];
  for (const src of l.sources) {
    const rel = posix(path.relative(l.dir, src)).replace(/[/\\]/g, "_");
    const obj = path.join(workDir, "libraries", l.name, rel + ".o");
    compile(src, obj, allIncludeDirs);
    const vobj = "/objects/" + l.name + "/" + rel + ".o";
    add(vobj, fs.readFileSync(obj));
    objects.push(vobj);
  }
  // Dependencies: other bundled libraries whose headers this library includes.
  const deps = new Set();
  for (const f of [...l.sources, ...l.headers]) for (const inc of includesOf(f)) {
    const owner = headerOwner.get(inc);
    if (owner && owner !== l.name) deps.add(owner);
  }
  libIndex.push({
    name: l.name,
    displayName: l.displayName,
    version: l.version,
    license: l.license,
    includeDirs: [vdir, ...(l.utilityDir ? [vdir + "/utility"] : [])],
    headers: l.topHeaders,
    objects,
    deps: [...deps],
  });
  console.log(`  ${l.displayName} ${l.version}: ${l.sources.length} sources, ${l.headers.length} headers${deps.size ? ", needs " + [...deps].join(", ") : ""}`);
}

// Core: compiled into an archive so the linker only pulls in what the sketch uses
// (e.g. Tone.o and its timer interrupt only when tone() is called), as the Arduino IDE does.
const coreObjs = [];
for (const src of walk(coreDir, (p) => SOURCE_EXT.test(p))) {
  const obj = path.join(workDir, "core", posix(path.relative(coreDir, src)).replace(/\//g, "_") + ".o");
  compile(src, obj, [coreDir, variantDir]);
  coreObjs.push(obj);
}
const coreA = path.join(workDir, "core.a");
execFileSync(bin("gcc-ar"), ["rcs", coreA, ...coreObjs]);
add("/libs/core.a", fs.readFileSync(coreA));
console.log(`  core ${CORE_VERSION}: ${coreObjs.length} objects`);

// Link inputs: C runtime, avr-libc, libgcc (debug info stripped to save space)
const avr5 = path.join(gccDir, "avr/lib/avr5");
for (const f of ["crtatmega328p.o", "libc.a", "libm.a", "libatmega328p.a"]) add("/libs/" + f, fs.readFileSync(path.join(avr5, f)));
const libgcc = path.join(workDir, "libgcc.a");
fs.copyFileSync(path.join(gccDir, "lib/gcc/avr/7.3.0/avr5/libgcc.a"), libgcc);
execFileSync(bin("strip"), ["-g", libgcc]);
add("/libs/libgcc.a", fs.readFileSync(libgcc));
// Linker scripts generated by the same binutils build as the WebAssembly ld.
for (const f of fs.readdirSync(path.join(toolsDir, "ldscripts"))) add("/ldscripts/" + f, fs.readFileSync(path.join(toolsDir, "ldscripts", f)));

// WebAssembly tools, plus the record of their sources (shown in the IDE for the GPL)
for (const t of ["cc1plus", "avr-as", "avr-ld", "avr-objcopy"]) add("/tools/" + t + ".wasm", fs.readFileSync(path.join(toolsDir, t + ".wasm")));
add("/licenses/compiler-sources.md", fs.readFileSync(path.join(toolsDir, "SOURCES.md")));

const manifest = {
  createdAt: new Date().toISOString(),
  core: { name: "Arduino AVR Boards", version: CORE_VERSION },
  gcc: GCC_VERSION,
  tools: "GCC 7.3.0 (Arduino patches) and binutils 2.42, built from source by toolchain/build.sh",
  libraries: libIndex,
};
const pack = writePack(files, manifest);
const gz = zlib.gzipSync(pack, { level: 9 });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, gz);

const mb = (n) => (n / 1048576).toFixed(1) + " MB";
const sizeOf = (prefix) => [...files].filter(([p]) => p.startsWith(prefix)).reduce((a, [, d]) => a + d.length, 0);
console.log(`\n${files.size} files, ${mb(pack.length)} raw -> ${mb(gz.length)} gzipped (${path.relative(root, outFile)})`);
for (const p of ["/tools", "/sysroot", "/arduino", "/libraries", "/objects", "/libs"]) console.log(`  ${p.padEnd(11)} ${mb(sizeOf(p))}`);
