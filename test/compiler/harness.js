// Loads the compiler pack and WebAssembly tools in Node, for tests and comparisons.
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPack } from "../../src/compiler/pack.js";
import { Toolchain } from "../../src/compiler/toolchain.js";
import createCc1plus from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/cc1plus.mjs";
import createAs from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/avr-as.mjs";
import createLd from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/avr-ld.mjs";
import createObjcopy from "../../node_modules/@horang-corp/avr-gcc-wasm/tools/avr-objcopy.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const packPath = path.join(root, "build/cache/compiler-pack.bin.gz");

export function loadToolchain() {
  if (!fs.existsSync(packPath)) throw new Error("Run `node build/prepare-compiler.mjs` first.");
  const { files, manifest } = readPack(new Uint8Array(zlib.gunzipSync(fs.readFileSync(packPath))));
  return new Toolchain({
    files,
    manifest,
    factories: { cc1plus: createCc1plus, "avr-as": createAs, "avr-ld": createLd, "avr-objcopy": createObjcopy },
  });
}
