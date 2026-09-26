import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { compress, encodeText } from "../build/embed.mjs";
import { decodeText } from "../src/embedded.js";
import { unlzma } from "../src/lzma.js";

const samples = [
  Buffer.alloc(0),
  Buffer.from([0, 13, 60]),
  Buffer.alloc(1000, 60),
  Buffer.from("void setup() {}\nvoid loop() {}\n".repeat(500)),
  crypto.randomBytes(100000),
];

test("text encoding round-trips and never contains NUL, CR or <", () => {
  for (const bytes of [...samples, ...Array.from({ length: 300 }, (_, n) => crypto.randomBytes(n))]) {
    const text = encodeText(bytes);
    assert.ok(!/[\0\r<]/.test(text));
    assert.deepEqual(Buffer.from(decodeText(text)), bytes);
  }
});

test("LZMA decoder round-trips xz output", () => {
  for (const bytes of samples) assert.deepEqual(Buffer.from(unlzma(compress(bytes))), bytes);
});
