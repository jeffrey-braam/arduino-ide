// The open sketch: one or more files shown as tabs. files[0] is the main .ino.
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

const ALLOWED_EXT = /\.(ino|h|hpp|cpp)$/i;

// Checks a new tab name; adds .ino when there's no extension. Returns { name } or { error }.
export function validateTabName(input, s) {
  let name = input.trim();
  if (!name) return { error: "Please enter a name." };
  if (!/\.[^.]+$/.test(name)) name += ".ino";
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) return { error: "Use only letters, numbers, _ . and -, starting with a letter, number or _." };
  if (!ALLOWED_EXT.test(name)) return { error: "Tabs can be .ino, .h, .hpp or .cpp files." };
  if (s.files.some((f) => f.name.toLowerCase() === name.toLowerCase())) return { error: `There's already a tab called “${name}”.` };
  return { name };
}

// Picks the main file among opened files: the .ino that defines setup(), else the first .ino.
export function orderOpenedFiles(opened) {
  const inos = opened.filter((f) => /\.(ino|pde)$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  const main = inos.find((f) => /\bvoid\s+setup\s*\(/.test(f.code)) ?? inos[0] ?? opened[0];
  return [main, ...opened.filter((f) => f !== main).sort((a, b) => a.name.localeCompare(b.name))];
}
