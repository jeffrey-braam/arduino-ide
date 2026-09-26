import { test } from "node:test";
import assert from "node:assert/strict";
import { preprocessSketch, findIncludes, mask } from "../src/compiler/preprocess.js";

const protos = (code) => preprocessSketch([{ name: "S.ino", code }]).prototypes;

test("declares functions defined after they are used", () => {
  assert.deepEqual(protos("void setup() { blink(3); }\nvoid loop() {}\nvoid blink(int n) { }\n"), ["void setup();", "void loop();", "void blink(int n);"]);
});

test("skips functions the student already declared", () => {
  assert.deepEqual(protos("int twice(int x);\nvoid setup() {}\nint twice(int x) { return 2 * x; }\n"), ["void setup();"]);
});

test("skips default arguments, class methods, ISRs and templates", () => {
  const code = [
    "void a(int x = 1) {}",
    "struct P { void m() {} };",
    "void P2::m() {}",
    "ISR(TIMER1_COMPA_vect) {}",
    "template <typename T> T id(T v) { return v; }",
    "if (x) {}",
  ].join("\n");
  assert.deepEqual(protos(code), []);
});

test("ignores braces and signatures inside comments and strings", () => {
  const code = '// void fake() {\n/* int nope() { */\nconst char *s = "void str() {";\nvoid real() {}\n';
  assert.deepEqual(protos(code), ["void real();"]);
});

test("leaves signatures split by #if lines alone", () => {
  const code = "#if defined(ESP32)\nIRAM_ATTR\n#endif\nvoid handler() {}\nvoid setup() {}\n";
  assert.deepEqual(protos(code), ["void setup();"]);
});

test("keeps the student's line numbers with #line", () => {
  const { cpp } = preprocessSketch([{ name: "S.ino", code: "int x;\nvoid setup() {}\nvoid loop() {}\n" }]);
  const lines = cpp.split("\n");
  assert.equal(lines[0], "#include <Arduino.h>");
  // After the prototypes, a #line directive puts `void setup() {}` back on line 2.
  const i = lines.indexOf("void setup() {}");
  assert.equal(lines[i - 1], '#line 2 "S.ino"');
});

test("merges extra .ino tabs with their own file names", () => {
  const { cpp, prototypes } = preprocessSketch([
    { name: "Main.ino", code: "void setup() { helper(); }\nvoid loop() {}\n" },
    { name: "helpers.ino", code: "void helper() {}\n" },
  ]);
  assert.ok(cpp.includes('#line 1 "helpers.ino"'));
  assert.ok(prototypes.includes("void helper();"));
  assert.match(cpp, /#line 1 "helpers\.ino"\nvoid helper\(\);/);
});

test("finds includes but not commented-out ones", () => {
  assert.deepEqual(findIncludes('#include <Servo.h>\n// #include <Nope.h>\n  #  include "local.h"\n'), ["Servo.h", "local.h"]);
});

test("mask keeps length and line breaks", () => {
  const code = 'a /* x\ny */ "s{" // c\nb';
  const m = mask(code);
  assert.equal(m.length, code.length);
  assert.equal(m.split("\n").length, code.split("\n").length);
  assert.ok(!m.includes("{"));
});
