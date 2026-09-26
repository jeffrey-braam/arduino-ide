import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseIntelHex, HexError } from "../src/upload/intelhex.js";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");

test("parses arduino-cli Blink output to the reported sketch size", () => {
  const image = parseIntelHex(fixture("Blink.ino.hex"));
  assert.equal(image.length, 922); // arduino-cli: "Sketch uses 922 bytes"
  assert.equal(image[0], 0x0c); // reset vector is a JMP (0x940C, little-endian)
  assert.equal(image[1], 0x94);
});

test("parses SerialEcho output to the reported sketch size", () => {
  assert.equal(parseIntelHex(fixture("SerialEcho.ino.hex")).length, 3344);
});

test("fills gaps with 0xFF and honours extended linear addresses", () => {
  const image = parseIntelHex([":020000040000FA", ":02000400ABCD82", ":00000001FF"].join("\n"));
  assert.deepEqual([...image], [0xff, 0xff, 0xff, 0xff, 0xab, 0xcd]);
});

test("rejects a bad checksum", () => {
  assert.throws(() => parseIntelHex(":02000400ABCD83\n:00000001FF"), HexError);
});

test("rejects a file without an end record", () => {
  assert.throws(() => parseIntelHex(":02000400ABCD82"), /incomplete/);
});

test("rejects non-hex content", () => {
  assert.throws(() => parseIntelHex("void setup() {}"), HexError);
});
