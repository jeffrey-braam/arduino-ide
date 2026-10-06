// The upload path the page uses: Web Serial port -> src/upload/stk500.js -> the Rust STK500 code,
// against a simulated Uno. (The protocol's own tests are in crates/core/src/stk500.rs.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../build/node-toolchain.mjs"; // loads the Rust core
import { parseIntelHex } from "#core";
import { uploadStk500, UploadError } from "../src/upload/stk500.js";
import { BOARDS } from "../src/boards.js";
import { FakeOptibootPort } from "./optiboot-sim.js";

const uno = BOARDS.uno.upload;
const blink = parseIntelHex(readFileSync(new URL("./fixtures/Blink.ino.hex", import.meta.url), "utf8"));

test("uploads and verifies Blink through Web Serial", async () => {
  const port = new FakeOptibootPort();
  const progress = [];
  const r = await uploadStk500(port, blink, { ...uno, onProgress: (f, phase) => progress.push([f, phase]) });
  assert.deepEqual(r, { bytes: 922, pages: 8 });
  assert.ok(blink.every((b, i) => port.flash[i] === b));
  assert.equal(port.readable, null, "port is closed afterwards");
  assert.deepEqual(progress.at(-1), [1, "Verifying"]);
  assert.equal(port.state, "app", "board restarts into the sketch");
});

test("reports problems as UploadError", async () => {
  const port = new FakeOptibootPort({ signature: [0x1e, 0x98, 0x01] });
  await assert.rejects(uploadStk500(port, blink, uno), (e) => e instanceof UploadError && /Wrong chip/.test(e.message));
  assert.equal(port.readable, null, "port is closed afterwards");
});

test("reports a busy port", async () => {
  const port = new FakeOptibootPort();
  await port.open({ baudRate: 9600 });
  await assert.rejects(uploadStk500(port, blink, uno), /Couldn't open the port.*already open/);
});
