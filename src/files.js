// Opening and saving files. Uses the File System Access API where available (Chrome, ChromeOS),
// falling back to a file input and plain downloads.
const SKETCH_TYPES = [{ description: "Arduino sketch", accept: { "text/plain": [".ino", ".cpp", ".c", ".h", ".txt"] } }];
const HEX_TYPES = [{ description: "Compiled sketch", accept: { "text/plain": [".hex"] } }];

const hasFsa = typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window;

const isAbort = (e) => e && e.name === "AbortError";

function pickWithInput(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

async function openText(types, accept) {
  if (hasFsa) {
    try {
      const [handle] = await window.showOpenFilePicker({ types });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  const file = await pickWithInput(accept);
  return file ? { name: file.name, text: await file.text(), handle: null } : null;
}

export const openSketchFile = () => openText(SKETCH_TYPES, ".ino,.cpp,.c,.h,.txt");
export const openHexFile = () => openText(HEX_TYPES, ".hex");

export async function writeToHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { name: suggestedName, handle: null };
}
