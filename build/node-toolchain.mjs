// Loads the Rust core, the compiler pack and the WebAssembly tools in Node (tests, and the
// example check in `cargo aide prepare-examples`). Needs `cargo aide wasm` first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initSync } from "#core";
import { Toolchain } from "../src/compiler/toolchain.js";
import createCc1plus from "../toolchain/out/cc1plus.mjs";
import createAs from "../toolchain/out/avr-as.mjs";
import createLd from "../toolchain/out/avr-ld.mjs";
import createObjcopy from "../toolchain/out/avr-objcopy.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const packPath = path.join(root, "build/cache/compiler-pack.bin.lzma");
const corePath = path.join(root, "build/cache/wasm/core/aide_wasm_bg.wasm");

if (!fs.existsSync(corePath)) throw new Error("Run `cargo aide wasm` first.");
initSync({ module: fs.readFileSync(corePath) });

// Under Node, an Emscripten program exiting with an error (e.g. cc1plus on a sketch with a
// mistake) also sets process.exitCode, which would fail the whole process. Restore it.
const keepExitCode = (factory) => async (opts) => {
  const mod = await factory(opts);
  const callMain = mod.callMain;
  mod.callMain = (args) => {
    const saved = process.exitCode;
    try {
      return callMain(args);
    } finally {
      process.exitCode = saved;
    }
  };
  return mod;
};

export function loadToolchain() {
  if (!fs.existsSync(packPath)) throw new Error("Run `cargo aide prepare-compiler` first.");
  return new Toolchain({
    pack: fs.readFileSync(packPath),
    factories: {
      cc1plus: keepExitCode(createCc1plus),
      "avr-as": keepExitCode(createAs),
      "avr-ld": keepExitCode(createLd),
      "avr-objcopy": keepExitCode(createObjcopy),
    },
  });
}
