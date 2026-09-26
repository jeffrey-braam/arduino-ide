// Main-thread side of the compiler: starts the worker with the embedded compiler data and
// sends it builds. The worker source and the compressed data are inlined into the page at build time.
import workerSource from "compiler-worker-source";
import { takeEmbedded } from "./embedded.js";

const packElement = typeof document !== "undefined" ? document.getElementById("compiler-pack") : null;
export const compilerAvailable = Boolean(packElement && workerSource);

let worker = null;
let ready = null; // Promise resolved when the toolchain is loaded
let packBytes = null; // decoded once; each worker gets a copy so a crashed one can be replaced
let nextId = 1;
const pending = new Map();

// Starts loading the compiler in the background. Safe to call more than once.
export function startCompiler() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    packBytes ??= takeEmbedded("compiler-pack");
    const pack = packBytes.slice();
    worker.onmessage = ({ data: msg }) => {
      if (msg.type === "ready") resolve(msg);
      else if (msg.type === "init-error") reject(new Error(msg.message));
      else if (msg.type === "log") pending.get(msg.id)?.log(msg.text);
      else if (msg.type === "result") {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (!p) return;
        if (msg.ok) p.resolve(msg.result);
        else p.reject(Object.assign(new Error(msg.error.message), msg.error));
      }
    };
    worker.onerror = (e) => {
      const err = new Error("The compiler stopped unexpectedly" + (e.message ? ": " + e.message : "") + ". Try again; if it keeps happening, reload the page.");
      reject(err);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
      ready = null; // allow a restart
    };
    worker.postMessage({ type: "init", pack }, [pack.buffer]);
  });
  return ready;
}

/**
 * @param {{ name: string, code: string }[]} files main .ino first
 * @returns {Promise<{ hex, image, flash, ram, libraries, warnings, output, timings }>}
 */
export async function compile(files, { log = () => {} } = {}) {
  if (!compilerAvailable) throw new Error("This copy of the IDE was built without the compiler.");
  await startCompiler();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, log });
    worker.postMessage({ type: "build", id, files });
  });
}
