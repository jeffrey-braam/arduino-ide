// Builds the examples/libraries data embedded in the IDE (build/cache/examples.json.gz):
// - Arduino's built-in examples (github.com/arduino/arduino-examples, CC0)
// - every example that ships with the bundled libraries
// Each example is compiled with the in-browser toolchain; only those that build for the Uno are kept.
//
// Needs the compiler pack (node build/prepare-compiler.mjs) and arduino-cli with the libraries.
// Usage: node build/prepare-examples.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadToolchain, root } from "./node-toolchain.mjs";

const EXAMPLES_TAG = "1.10.3";
const EXAMPLES_URL = `https://codeload.github.com/arduino/arduino-examples/zip/refs/tags/${EXAMPLES_TAG}`;
const EXAMPLES_SHA256 = "cc7397c9b50ba5efc634a7c605522f49b5dd422f9c097fff17899fe921d0f006";
const CORE_VERSION = "1.8.8";

const cacheDir = path.join(root, "build/cache");
const outFile = path.join(cacheDir, "examples.json.gz");
const SKETCH_FILE = /\.(ino|h|hpp|cpp)$/i;

// ---------- Minimal ZIP reader (stored + deflate), enough for a GitHub source archive ----------
function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + csize);
    if (!name.endsWith("/")) files.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function builtinArchive() {
  const zipPath = path.join(cacheDir, `arduino-examples-${EXAMPLES_TAG}.zip`);
  if (!fs.existsSync(zipPath)) {
    console.log("Downloading", EXAMPLES_URL);
    const res = await fetch(EXAMPLES_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(zipPath);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha !== EXAMPLES_SHA256) throw new Error(`Checksum mismatch for ${zipPath}: ${sha}`);
  return readZip(buf);
}

// ---------- Collect examples ----------
// Built-in: "<prefix>/examples/01.Basics/Blink/Blink.ino" -> category "Basics", example "Blink".
function builtinExamples(zip) {
  const byDir = new Map();
  for (const [name, data] of zip) {
    const m = name.match(/^[^/]+\/examples\/([^/]+)\/(.+)\/([^/]+)$/);
    if (!m || !SKETCH_FILE.test(m[3])) continue;
    const key = m[1] + "/" + m[2];
    if (!byDir.has(key)) byDir.set(key, { categoryDir: m[1], dir: m[2], files: [] });
    byDir.get(key).files.push({ name: m[3], code: data.toString("utf8") });
  }
  const out = [];
  for (const e of byDir.values()) {
    const exName = e.dir.split("/").pop();
    if (!e.files.some((f) => f.name === exName + ".ino")) continue;
    out.push({ categoryDir: e.categoryDir, category: e.categoryDir.replace(/^\d+\./, "").replace(/_/g, " "), name: e.dir, files: orderFiles(e.files, exName) });
  }
  return out;
}

// Main .ino first, then the rest alphabetically (the Arduino IDE's tab order).
function orderFiles(files, sketchName) {
  const main = files.find((f) => f.name === sketchName + ".ino");
  return [main, ...files.filter((f) => f !== main).sort((a, b) => a.name.localeCompare(b.name))];
}

function libraryExamples(dir) {
  const out = [];
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      // Older libraries still ship sketches as .pde, the pre-2011 extension; they're opened as .ino.
      if (fs.existsSync(path.join(p, e.name + ".ino")) || fs.existsSync(path.join(p, e.name + ".pde"))) {
        const files = fs
          .readdirSync(p)
          .filter((f) => (SKETCH_FILE.test(f) || /\.pde$/i.test(f)) && fs.statSync(path.join(p, f)).isFile())
          .map((f) => ({ name: f.replace(/\.pde$/i, ".ino"), code: fs.readFileSync(path.join(p, f), "utf8") }));
        out.push({ name: r, files: orderFiles(files, e.name) });
      } else walk(p, r);
    }
  };
  walk(path.join(dir, "examples"), "");
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Library licenses (curated in licenses/libraries.json) ----------
const licensesDir = path.join(root, "licenses");
const libraryLicenses = JSON.parse(fs.readFileSync(path.join(licensesDir, "libraries.json"), "utf8"));

// The first /* ... */ comment that states a license, with comment decoration removed.
function licenseComment(text) {
  for (const m of text.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    if (/copyright|licen[cs]e|permission is hereby/i.test(m[1])) return m[1].split("\n").map((l) => l.replace(/^\s*\*?\s?/, "")).join("\n").trim();
  }
  return null;
}

// An AsciiDoc "== Section ==" up to the next heading.
function docSection(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^==\\s*${name}\\s*(==)?\\s*$`, "i").test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^==\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

function libraryLicense(name, dir) {
  const info = libraryLicenses[name];
  if (!info) throw new Error(`No license entry for library ${name}: add it to licenses/libraries.json after checking its license.`);
  const texts = fs
    .readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying)/i.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .map((f) => ({ title: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
  if (info.notice) {
    const n = info.notice;
    let text;
    if (n.repoFile) text = fs.readFileSync(path.join(licensesDir, n.repoFile), "utf8").trim();
    else {
      const src = fs.readFileSync(path.join(dir, n.file), "utf8");
      text = n.section ? docSection(src, n.section) : licenseComment(src);
    }
    if (!text) throw new Error(`Couldn't find the license notice for ${name} (${JSON.stringify(n)})`);
    texts.push({ title: n.repoFile ? "License notice" : `License notice in ${n.file}`, text });
  }
  if (!texts.length && !info.texts) throw new Error(`Library ${name} has no license text to show`);
  return { license: info.license, licenseNote: info.note || "", licenseTexts: texts, sharedTexts: info.texts || [] };
}

function readProperties(dir) {
  const file = path.join(dir, "library.properties");
  const props = {};
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([\w.]+)=(.*)$/);
    if (m) props[m[1]] = m[2].trim();
  }
  return props;
}

// ---------- Main ----------
const cli = process.env.ARDUINO_CLI || (process.platform === "win32" ? "C:/Program Files/Arduino CLI/arduino-cli.exe" : "arduino-cli");
const cfg = (k) => execFileSync(cli, ["config", "get", k], { encoding: "utf8" }).trim();
const coreLibs = path.join(cfg("directories.data"), "packages/arduino/hardware/avr", CORE_VERSION, "libraries");
const userLibs = path.join(cfg("directories.user"), "libraries");

const tc = loadToolchain();
async function compiles(files) {
  try {
    await tc.build({ files });
    return true;
  } catch {
    return false;
  }
}

let kept = 0, dropped = 0;
async function keepCompiling(examples, label) {
  const out = [];
  for (const ex of examples) {
    if (await compiles(ex.files)) {
      out.push(ex);
      kept++;
    } else {
      dropped++;
      console.log(`  skip ${label}/${ex.name} (doesn't compile for the Uno)`);
    }
  }
  return out;
}

console.log("Built-in examples");
const builtin = [];
const allBuiltin = builtinExamples(await builtinArchive()).sort((a, b) => a.categoryDir.localeCompare(b.categoryDir) || a.name.localeCompare(b.name));
for (const categoryDir of [...new Set(allBuiltin.map((e) => e.categoryDir))]) {
  const inCat = allBuiltin.filter((e) => e.categoryDir === categoryDir);
  const examples = await keepCompiling(inCat.map(({ name, files }) => ({ name, files })), inCat[0].category);
  if (examples.length) builtin.push({ category: inCat[0].category, examples });
}

console.log("Library examples");
const libraries = [];
for (const lib of tc.manifest.libraries) {
  const dir = fs.existsSync(path.join(coreLibs, lib.name)) ? path.join(coreLibs, lib.name) : path.join(userLibs, lib.name);
  const p = readProperties(dir);
  libraries.push({
    name: lib.name,
    displayName: lib.displayName,
    version: lib.version,
    author: p.author || "",
    sentence: p.sentence || "",
    paragraph: p.paragraph || "",
    url: p.url || "",
    ...libraryLicense(lib.name, dir),
    // Headers to #include: the library's declared ones, else its top-level headers.
    includes: p.includes ? p.includes.split(",").map((s) => s.trim()).filter(Boolean) : lib.headers,
    examples: await keepCompiling(libraryExamples(dir), lib.displayName),
  });
}

const data = {
  createdAt: new Date().toISOString(),
  builtinSource: `arduino/arduino-examples ${EXAMPLES_TAG} (CC0-1.0)`,
  builtin,
  libraries,
};
const json = Buffer.from(JSON.stringify(data));
const gz = zlib.gzipSync(json, { level: 9 });
fs.writeFileSync(outFile, gz);
console.log(`\n${kept} examples kept, ${dropped} skipped. ${(json.length / 1024).toFixed(0)} KB -> ${(gz.length / 1024).toFixed(0)} KB gzipped (${path.relative(root, outFile)})`);
