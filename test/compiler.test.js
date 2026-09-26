// Runs the real WebAssembly toolchain. Skipped until `node build/prepare-compiler.mjs` has been run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { packPath, loadToolchain } from "./compiler/harness.js";

const skip = !fs.existsSync(packPath) && "compiler pack not built";
const tc = skip ? null : loadToolchain();
const sketch = (dir) => ({ name: dir + ".ino", code: fs.readFileSync(new URL(`./sketches/${dir}/${dir}.ino`, import.meta.url), "utf8") });

test("compiles Blink close to arduino-cli's size", { skip }, async () => {
  const code = fs.readFileSync(new URL("./fixtures/Blink.ino", import.meta.url), "utf8");
  const r = await tc.build({ files: [{ name: "Blink.ino", code }] });
  assert.ok(r.flash > 800 && r.flash < 922 * 1.2, `flash ${r.flash}`); // arduino-cli (with LTO): 922
  assert.equal(r.image.length, r.flash);
  assert.match(r.hex, /^:/);
});

test("links the libraries a sketch includes, with their dependencies", { skip }, async () => {
  const r = await tc.build({ files: [sketch("TempDS18B20")] });
  assert.deepEqual(r.libraries.sort(), ["DallasTemperature", "OneWire"]);
});

test("compiles a sketch that calls a function before defining it", { skip }, async () => {
  const r = await tc.build({ files: [sketch("Melody")] });
  assert.ok(r.flash > 0);
});

test("compiles multi-tab sketches", { skip }, async () => {
  const dir = new URL("./sketches/MultiTab/", import.meta.url);
  const files = ["MultiTab.ino", "leds.ino", "config.h"].map((name) => ({ name, code: fs.readFileSync(new URL(name, dir), "utf8") }));
  const r = await tc.build({ files });
  assert.ok(r.flash > 0);
});

test("uses the sketch's own copy of a header instead of the library", { skip }, async () => {
  const main = { name: "Lcd.ino", code: '#include "LiquidCrystal.h"\nvoid setup() { lcdInit(); }\nvoid loop() {}\n' };
  const header = { name: "LiquidCrystal.h", code: "void lcdInit();\n" };
  const impl = { name: "LiquidCrystal.cpp", code: '#include "LiquidCrystal.h"\nvoid lcdInit() {}\n' };
  const r = await tc.build({ files: [main, header, impl] });
  assert.deepEqual(r.libraries, []);
});

test("reports errors at the student's line", { skip }, async () => {
  await assert.rejects(tc.build({ files: [sketch("HasError")] }), (e) => {
    assert.equal(e.message, "Compilation failed.");
    assert.deepEqual(
      e.diagnostics.map((d) => [d.file, d.line, d.severity]),
      [["HasError.ino", 7, "error"]],
    );
    return true;
  });
});
