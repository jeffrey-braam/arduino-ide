// Loads the compiler pack and WebAssembly tools in Node (build scripts and tests).
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPack } from "../src/compiler/pack.js";
import { Toolchain } from "../src/compiler/toolchain.js";
import createCc1plus from "../toolchain/out/cc1plus.mjs";
import createAs from "../toolchain/out/avr-as.mjs";
import createLd from "../toolchain/out/avr-ld.mjs";
import createObjcopy from "../toolchain/out/avr-objcopy.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const packPath = path.join(root, "build/cache/compiler-pack.bin.gz");

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
  if (!fs.existsSync(packPath)) throw new Error("Run `node build/prepare-compiler.mjs` first.");
  const { files, manifest } = readPack(new Uint8Array(zlib.gunzipSync(fs.readFileSync(packPath))));
  return new Toolchain({
    files,
    manifest,
    factories: {
      cc1plus: keepExitCode(createCc1plus),
      "avr-as": keepExitCode(createAs),
      "avr-ld": keepExitCode(createLd),
      "avr-objcopy": keepExitCode(createObjcopy),
    },
  });
}
