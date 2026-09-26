// Compiles sketches with both the WebAssembly toolchain and arduino-cli and compares the results.
// Sketches: test/sketches/*, test/fixtures/*.ino, and every example of every bundled library.
// Reference results are cached in build/cache/reference.json (arduino-cli is slow).
//
// Usage: node test/compiler/compare.mjs [filter]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadToolchain, root } from "./harness.js";

const run = promisify(execFile);
const CLI = process.env.ARDUINO_CLI || (process.platform === "win32" ? "C:/Program Files/Arduino CLI/arduino-cli.exe" : "arduino-cli");
const cachePath = path.join(root, "build/cache/reference.json");
const filter = process.argv[2] ? new RegExp(process.argv[2], "i") : null;

const tc = loadToolchain();
const libraryRoots = tc.manifest.libraries.map((l) => l.name);

async function cliDir(key) {
  return (await run(CLI, ["config", "get", key])).stdout.trim();
}
const userLibs = path.join(await cliDir("directories.user"), "libraries");
const coreLibs = path.join(await cliDir("directories.data"), "packages/arduino/hardware/avr/1.8.8/libraries");

// ---------- Collect sketches ----------
function findSketchDirs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (fs.existsSync(path.join(p, e.name + ".ino"))) out.push(p);
    else out.push(...findSketchDirs(p));
  }
  return out;
}

const sketches = [];
for (const d of findSketchDirs(path.join(root, "test/sketches"))) sketches.push({ group: "student", dir: d });
for (const lib of libraryRoots) {
  const base = fs.existsSync(path.join(coreLibs, lib)) ? path.join(coreLibs, lib) : path.join(userLibs, lib);
  for (const d of findSketchDirs(path.join(base, "examples"))) sketches.push({ group: lib, dir: d });
}
const selected = sketches.filter((s) => !filter || filter.test(s.dir));

function readSketch(dir) {
  const name = path.basename(dir);
  const others = fs.readdirSync(dir).filter((f) => f !== name + ".ino" && /\.(ino|h|hpp|cpp|c)$/i.test(f)).sort();
  return [name + ".ino", ...others].map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), "utf8") }));
}

// ---------- Reference (arduino-cli), cached ----------
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
async function reference(dir, files) {
  const key = crypto.createHash("sha1").update(dir + JSON.stringify(files)).digest("hex");
  if (cache[key]) return cache[key];
  // Parallel arduino-cli runs occasionally collide on its shared core cache; retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await referenceOnce(dir);
    if (r.ok || attempt === 1) return (cache[key] = r);
  }
}
async function referenceOnce(dir) {
  let result;
  try {
    const { stdout } = await run(CLI, ["compile", "--fqbn", "arduino:avr:uno", "--format", "json", dir], { maxBuffer: 64 << 20 });
    const j = JSON.parse(stdout);
    const sizes = Object.fromEntries((j.builder_result?.executable_sections_size || []).map((s) => [s.name, s.size]));
    result = { ok: j.success !== false, flash: (sizes.text || 0) + (sizes.data || 0) || null };
  } catch (e) {
    let out = e.stdout || "";
    try {
      out = JSON.parse(out).compiler_err || out;
    } catch {}
    result = { ok: false, error: String(out || e.message).slice(0, 400) };
  }
  return result;
}

// ---------- Run ----------
const rows = [];
let i = 0;
async function worker() {
  while (i < selected.length) {
    const s = selected[i++];
    const files = readSketch(s.dir);
    const ref = await reference(s.dir, files);
    let wasm;
    try {
      const r = await tc.build({ files });
      wasm = { ok: true, flash: r.flash, ms: r.timings.totalMs };
    } catch (e) {
      wasm = { ok: false, error: (e.output || e.message).split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" | ") || e.message };
    }
    rows.push({ group: s.group, name: path.basename(s.dir), ref, wasm });
    const status = ref.ok === wasm.ok ? (ref.ok ? "same " : "both-fail") : wasm.ok ? "WASM-ONLY" : "WASM-FAIL";
    console.log(`${status.padEnd(9)} ${s.group.padEnd(24)} ${path.basename(s.dir).padEnd(32)} ref=${ref.flash ?? "-"} wasm=${wasm.flash ?? "-"} ${wasm.ms ? wasm.ms + "ms" : ""}${!wasm.ok && ref.ok ? "\n          " + wasm.error : ""}`);
  }
}
// The WebAssembly builds share one toolchain; arduino-cli calls run in parallel.
await Promise.all([worker(), worker(), worker(), worker()]);
fs.mkdirSync(path.dirname(cachePath), { recursive: true });
fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));

const both = rows.filter((r) => r.ref.ok && r.wasm.ok);
const ratio = both.map((r) => r.wasm.flash / r.ref.flash).sort((a, b) => a - b);
const times = both.map((r) => r.wasm.ms).sort((a, b) => a - b);
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
console.log(`
${rows.length} sketches
  compile in both:        ${both.length}
  fail in both:           ${rows.filter((r) => !r.ref.ok && !r.wasm.ok).length}
  fail only in browser:   ${rows.filter((r) => r.ref.ok && !r.wasm.ok).length}
  fail only in arduino-cli: ${rows.filter((r) => !r.ref.ok && r.wasm.ok).length}
  size vs arduino-cli:    median ${((pct(ratio, 0.5) - 1) * 100).toFixed(1)}% larger, worst ${((ratio.at(-1) - 1) * 100).toFixed(1)}%
  browser build time:     median ${pct(times, 0.5)} ms, slowest ${times.at(-1)} ms (this PC, Node)`);
process.exitCode = rows.some((r) => r.ref.ok && !r.wasm.ok) ? 1 : 0;
