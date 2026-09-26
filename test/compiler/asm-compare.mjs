// Checks the WebAssembly cc1plus against the Arduino IDE's native avr-g++ 7.3.0: both compile the
// same preprocessed sketch with the same flags, and the assembly must match exactly.
//
// Usage: node test/compiler/asm-compare.mjs [filter]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadToolchain, root } from "./harness.js";

const CLI = process.env.ARDUINO_CLI || (process.platform === "win32" ? "C:/Program Files/Arduino CLI/arduino-cli.exe" : "arduino-cli");
const cfg = (k) => execFileSync(CLI, ["config", "get", k], { encoding: "utf8" }).trim();
const pkg = path.join(cfg("directories.data"), "packages/arduino");
const hw = path.join(pkg, "hardware/avr/1.8.8");
const gxx = path.join(pkg, "tools/avr-gcc/7.3.0-atmel3.6.1-arduino7/bin/avr-g++" + (process.platform === "win32" ? ".exe" : ""));
const userLibs = path.join(cfg("directories.user"), "libraries");
const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;

const tc = loadToolchain();
const libDir = (name) => {
  const base = fs.existsSync(path.join(hw, "libraries", name)) ? path.join(hw, "libraries", name) : path.join(userLibs, name);
  return fs.existsSync(path.join(base, "src")) ? [path.join(base, "src")] : [base, ...(fs.existsSync(path.join(base, "utility")) ? [path.join(base, "utility")] : [])];
};

function sketchDirs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (fs.existsSync(path.join(p, e.name + ".ino"))) out.push(p);
    else out.push(...sketchDirs(p));
  }
  return out;
}
const dirs = [path.join(root, "test/sketches"), ...tc.manifest.libraries.map((l) => path.join(libDir(l.name)[0].replace(/[\\/]src$/, ""), "examples"))].flatMap(sketchDirs);

// Only the instructions matter; drop the .file/.ident lines and the `; 301 "path" 1` comments
// around inline assembly, which name host paths and versions. (Windows writes CRLF.)
const normalize = (asm) =>
  asm
    .split(/\r?\n/)
    .filter((l) => !/^\s*\.(file|ident)\b/.test(l) && !/^\s*;\s*\d+\s+".*"/.test(l))
    .join("\n");
const FLAGS = ["-S", "-Os", "-w", "-std=gnu++11", "-fpermissive", "-fno-exceptions", "-ffunction-sections", "-fdata-sections", "-fno-threadsafe-statics", "-Wno-error=narrowing", "-mmcu=atmega328p", "-DF_CPU=16000000L", "-DARDUINO=10607", "-DARDUINO_AVR_UNO", "-DARDUINO_ARCH_AVR"];

let same = 0, differ = 0, skipped = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asmcmp-"));
for (const dir of dirs.filter((d) => !filter || filter.test(d))) {
  const name = path.basename(dir);
  const files = fs.readdirSync(dir).filter((f) => /\.(ino|h|hpp|cpp)$/i.test(f)).sort((a, b) => (a === name + ".ino" ? -1 : b === name + ".ino" ? 1 : a.localeCompare(b)))
    .map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), "utf8") }));
  let r;
  try {
    r = await tc.build({ files, keepAssembly: true });
  } catch {
    skipped++;
    continue; // doesn't compile for the Uno at all (checked by compare.mjs)
  }
  // Compile the same translation units natively, in a folder laid out like the virtual one.
  const work = path.join(tmp, name);
  fs.mkdirSync(work, { recursive: true });
  for (const f of files) if (!/\.ino$/i.test(f.name)) fs.writeFileSync(path.join(work, f.name), f.code);
  const incs = [path.join(hw, "cores/arduino"), path.join(hw, "variants/standard"), ...r.libraries.flatMap(libDir)].flatMap((d) => ["-I", d]);
  let ok = true;
  for (const unit of r.assembly) {
    const src = path.join(work, unit.unit);
    fs.writeFileSync(src, unit.source);
    const native = execFileSync(gxx, [...FLAGS, "-I", work, ...incs, src, "-o", "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
    if (normalize(native) !== normalize(unit.text)) {
      ok = false;
      const a = normalize(native).split("\n"), b = normalize(unit.text).split("\n");
      const i = a.findIndex((l, k) => l !== b[k]);
      console.log(`DIFFER ${name}/${unit.unit} at asm line ${i + 1}:\n  native: ${a[i]}\n  wasm:   ${b[i]}`);
    }
  }
  ok ? same++ : differ++;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nIdentical assembly: ${same}   different: ${differ}   not compilable for the Uno: ${skipped}`);
process.exitCode = differ ? 1 : 0;
