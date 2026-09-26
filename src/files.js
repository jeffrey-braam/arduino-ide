// Opening and saving files. Uses the File System Access API where available (Chrome, ChromeOS),
// falling back to a file input and plain downloads.
const SKETCH_TYPES = [{ description: "Arduino sketch", accept: { "text/plain": [".ino", ".cpp", ".h", ".hpp", ".txt"] } }];
const HEX_TYPES = [{ description: "Compiled sketch", accept: { "text/plain": [".hex"] } }];

const hasFsa = typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window;
const hasDirectoryPicker = typeof window !== "undefined" && "showDirectoryPicker" in window;

const isAbort = (e) => e && e.name === "AbortError";

function pickWithInput(accept, multiple) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...input.files]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

// Resolves with [{ name, text, handle }] (empty if cancelled).
async function openText(types, accept, multiple) {
  if (hasFsa) {
    try {
      const handles = await window.showOpenFilePicker({ types, multiple });
      return Promise.all(
        handles.map(async (handle) => {
          const file = await handle.getFile();
          return { name: file.name, text: await file.text(), handle };
        }),
      );
    } catch (e) {
      if (isAbort(e)) return [];
      throw e;
    }
  }
  const picked = await pickWithInput(accept, multiple);
  return Promise.all(picked.map(async (file) => ({ name: file.name, text: await file.text(), handle: null })));
}

// A sketch can be several files (tabs); select them all to open them together.
export const openSketchFiles = () => openText(SKETCH_TYPES, ".ino,.cpp,.h,.hpp,.txt", true);
export const openHexFile = async () => (await openText(HEX_TYPES, ".hex", false))[0] ?? null;

export async function writeToHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Resolves with { name, handle } or null if cancelled. handle is null for the download fallback.
export async function saveAs(suggestedName, text) {
  if (hasFsa) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: SKETCH_TYPES });
      await writeToHandle(handle, text);
      return { name: handle.name, handle };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  download(suggestedName, text);
  return { name: suggestedName, handle: null };
}

// Writes every file of a multi-file sketch into `dir`, deleting tabs that were removed.
export async function writeFolder(dir, files, removed = []) {
  for (const f of files) await writeToHandle(await dir.getFileHandle(f.name, { create: true }), f.code);
  for (const name of removed) {
    if (files.some((f) => f.name === name)) continue;
    try {
      await dir.removeEntry(name);
    } catch {}
  }
}

// Saves a multi-file sketch as a folder named after it, inside a folder the user picks (the
// Arduino layout: Blink/Blink.ino, Blink/pitches.h). Picking the sketch folder itself also works.
// Resolves with { dirHandle } or null if cancelled; dirHandle is null for the download fallback.
export async function saveFolderAs(folderName, files) {
  if (hasDirectoryPicker) {
    let parent;
    try {
      parent = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
    const dir = parent.name === folderName ? parent : await parent.getDirectoryHandle(folderName, { create: true });
    await writeFolder(dir, files);
    return { dirHandle: dir };
  }
  for (const f of files) download(f.name, f.code);
  return { dirHandle: null };
}
