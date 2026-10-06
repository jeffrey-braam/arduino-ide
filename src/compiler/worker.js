// Compiler Web Worker: unpacks the embedded compiler data and runs builds off the main thread.
import { loadCore } from "../core.js";
import { Toolchain } from "./toolchain.js";
import createCc1plus from "../../toolchain/out/cc1plus.mjs";
import createAs from "../../toolchain/out/avr-as.mjs";
import createLd from "../../toolchain/out/avr-ld.mjs";
import createObjcopy from "../../toolchain/out/avr-objcopy.mjs";

let toolchain = null;

self.onmessage = async ({ data: msg }) => {
  if (msg.type === "init") {
    try {
      const t0 = performance.now();
      await loadCore(msg.core); // the Rust core, compiled by the page
      toolchain = new Toolchain({
        pack: msg.pack,
        factories: { cc1plus: createCc1plus, "avr-as": createAs, "avr-ld": createLd, "avr-objcopy": createObjcopy },
      });
      await toolchain.init();
      self.postMessage({ type: "ready", ms: Math.round(performance.now() - t0), manifest: toolchain.manifest });
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
      const compileError = e?.name === "CompileError";
      self.postMessage({
        type: "result",
        id: msg.id,
        ok: false,
        error: {
          message: String(e?.message || e),
          diagnostics: compileError ? e.diagnostics : [],
          output: compileError ? e.output : String(e?.stack || ""),
        },
      });
    }
  }
};
