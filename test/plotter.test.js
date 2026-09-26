import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlotLine } from "../src/plotter.js";

test("a single number", () => {
  assert.deepEqual(parsePlotLine("512"), [{ label: "value 1", value: 512 }]);
});

test("several numbers separated by spaces, tabs or commas", () => {
  assert.deepEqual(parsePlotLine("1 2.5\t-3,4e2"), [
    { label: "value 1", value: 1 },
    { label: "value 2", value: 2.5 },
    { label: "value 3", value: -3 },
    { label: "value 4", value: 400 },
  ]);
});

test("label:value pairs", () => {
  assert.deepEqual(parsePlotLine("light:300,temp:21.5"), [
    { label: "light", value: 300 },
    { label: "temp", value: 21.5 },
  ]);
});

test("text lines are ignored", () => {
  assert.deepEqual(parsePlotLine("SerialEcho ready"), []);
  assert.deepEqual(parsePlotLine(""), []);
  assert.deepEqual(parsePlotLine("label:abc"), []);
});
