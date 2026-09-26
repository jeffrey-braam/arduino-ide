// Compiler Web Worker: unpacks the embedded compiler data and runs builds off the main thread.
import { readPack } from "./pack.js";
import { Toolchain, CompileError } from "./toolchain.js";
import createCc1plus from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/cc1plus.mjs";
import createAs from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/avr-as.mjs";
import createLd from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/avr-ld.mjs";
import createObjcopy from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/avr-objcopy.mjs";

let toolchain = null;

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.onmessage = async ({ data: msg }) => {
  if (msg.type === "init") {
    try {
      const t0 = performance.now();
      const { files, manifest } = readPack(await gunzip(msg.pack));
      toolchain = new Toolchain({
        files,
        manifest,
        factories: { cc1plus: createCc1plus, "avr-as": createAs, "avr-ld": createLd, "avr-objcopy": createObjcopy },
      });
      await toolchain.init();
      self.postMessage({ type: "ready", ms: Math.round(performance.now() - t0), manifest });
    } catch (e) {
      self.postMessage({ type: "init-error", message: String(e?.message || e) });
    }
    return;
  }

  if (msg.type === "build") {
    const log = (text) => self.postMessage({ type: "log", id: msg.id, text });
    try {
      const r = await toolchain.build({ files: msg.files, log });
      self.postMessage({ type: "result", id: msg.id, ok: true, result: r }, [r.image.buffer]);
    } catch (e) {
      self.postMessage({
        type: "result",
        id: msg.id,
        ok: false,
        error: {
          message: String(e?.message || e),
          diagnostics: e instanceof CompileError ? e.diagnostics : [],
          output: e instanceof CompileError ? e.output : String(e?.stack || ""),
        },
      });
    }
  }
};
