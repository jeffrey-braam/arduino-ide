import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uploadStk500, UploadError } from "../src/upload/stk500.js";
import { parseIntelHex } from "../src/upload/intelhex.js";
import { BOARDS } from "../src/boards.js";
import { FakeOptibootPort } from "./optiboot-sim.js";

const uno = BOARDS.uno.upload;
const blink = parseIntelHex(readFileSync(new URL("./fixtures/Blink.ino.hex", import.meta.url), "utf8"));

function flashMatches(port, image) {
  return image.every((b, i) => port.flash[i] === b);
}

test("uploads and verifies Blink on an Uno-like bootloader", async () => {
  const port = new FakeOptibootPort();
  const progress = [];
  const r = await uploadStk500(port, blink, { ...uno, onProgress: (f, phase) => progress.push([f, phase]) });
  assert.equal(r.pages, 8);
  assert.ok(flashMatches(port, blink));
  assert.equal(port.pageWrites, 8);
  assert.equal(port.readable, null, "port is closed afterwards");
  assert.equal(progress.at(-1)[0], 1);
  assert.equal(port.state, "app", "board restarts into the sketch");
});

test("works whatever the bootloader's blink length", async () => {
  for (const blinkMs of [0, 150, 400, 500]) {
    const port = new FakeOptibootPort({ blinkMs });
    await uploadStk500(port, blink, uno);
    assert.ok(flashMatches(port, blink), "blinkMs=" + blinkMs);
  }
});

test("fills a full 32256-byte sketch", async () => {
  const big = new Uint8Array(uno.maxSize).map((_, i) => (i * 7) & 0xff);
  const port = new FakeOptibootPort();
  await uploadStk500(port, big, uno);
  assert.ok(flashMatches(port, big));
});

test("refuses a sketch that is too big", async () => {
  const port = new FakeOptibootPort();
  await assert.rejects(uploadStk500(port, new Uint8Array(uno.maxSize + 1), uno), UploadError);
  assert.equal(port.resets, 0, "doesn't touch the board");
});

test("detects a verification mismatch", async () => {
  const port = new FakeOptibootPort({ corruptWriteAt: 300 });
  await assert.rejects(uploadStk500(port, blink, uno), /Verification failed at address 0x012c/);
});

test("reports the wrong chip", async () => {
  const port = new FakeOptibootPort({ signature: [0x1e, 0x98, 0x01] });
  await assert.rejects(uploadStk500(port, blink, uno), /Wrong chip/);
});

test("gives up cleanly when the board never answers", async () => {
  const port = new FakeOptibootPort({ baudRate: 57600 }); // bootloader at a different speed
  await assert.rejects(uploadStk500(port, blink, uno), /didn't respond/);
  assert.equal(port.resets, 4, "opening the port plus three reset pulses");
  assert.equal(port.readable, null, "port is closed afterwards");
});

test("reports a busy port", async () => {
  const port = new FakeOptibootPort();
  await port.open({ baudRate: 9600 });
  await assert.rejects(uploadStk500(port, blink, uno), /Couldn't open the port/);
});
