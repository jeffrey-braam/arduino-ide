// The IDE's logic is Rust (crates/), compiled to WebAssembly. The page loads it once at startup
// (src/app.js) and hands the compiled module to the compiler worker.
import init from "#core";

let compiled = null;

/** @param {BufferSource | WebAssembly.Module} source */
export async function loadCore(source) {
  compiled = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  await init({ module_or_path: compiled });
  return compiled;
}

export const coreModule = () => compiled;
