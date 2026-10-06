// The open sketch: one or more files shown as tabs. files[0] is the main .ino.
// Tab name rules and ordering are in Rust (crates/core/src/sketch.rs).
import { validateTabName as validate, orderOpenedFiles as order } from "#core";

export const DEFAULT_CODE = `void setup() {
  // put your setup code here, to run once:

}

void loop() {
  // put your main code here, to run repeatedly:

}
`;

export function newSketchName() {
  const d = new Date();
  return "sketch_" + d.toLocaleString("en", { month: "short" }).toLowerCase() + d.getDate() + ".ino";
}

export const baseName = (fileName) => fileName.replace(/\.[^.]*$/, "");

export function makeSketch(files, { active = 0 } = {}) {
  return {
    files: files.map((f) => ({ name: f.name, code: f.code, savedCode: f.savedCode ?? f.code })),
    active: Math.min(active, files.length - 1),
    dirHandle: null, // FileSystemDirectoryHandle: where Save writes a multi-file sketch (else each file's own handle)
    removed: [], // tabs deleted since the last save to a folder
  };
}

export const newSketch = () => makeSketch([{ name: newSketchName(), code: DEFAULT_CODE }]);

export const isDirty = (s) => s.removed.length > 0 || s.files.some((f) => f.code !== f.savedCode);

export function markSaved(s) {
  for (const f of s.files) f.savedCode = f.code;
  s.removed = [];
}

// Autosave format: { v: 2, files, active }. Version 1 stored a single { name, code, savedCode }.
export function toStorage(s) {
  return { v: 2, files: s.files, active: s.active };
}

export function fromStorage(data) {
  if (!data) return null;
  if (Array.isArray(data.files) && data.files.length) return makeSketch(data.files, { active: data.active || 0 });
  if (typeof data.code === "string") return makeSketch([{ name: data.name || newSketchName(), code: data.code, savedCode: data.savedCode ?? data.code }]);
  return null;
}

// Checks a new tab name; adds .ino when there's no extension. Returns { name } or { error }.
export const validateTabName = (input, s) => validate(input, s.files.map((f) => f.name));

// Picks the main file among opened files: the .ino that defines setup(), else the first .ino.
export function orderOpenedFiles(opened) {
  return Array.from(order(opened.map(({ name, code }) => ({ name, code }))), (i) => opened[i]);
}
