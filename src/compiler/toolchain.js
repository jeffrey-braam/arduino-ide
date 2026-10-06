// Runs the WebAssembly GCC toolchain (cc1plus -> as -> ld -> objcopy) on a sketch. The Rust core
// (crates/core/src/toolchain.rs) decides what to run; this file only starts the Emscripten tools
// for it. Works in a browser worker and in Node. Each tool run gets a fresh Emscripten instance
// with an in-memory filesystem; the compiled WebAssembly modules are reused between runs.
import { Toolchain as CoreToolchain } from "#core";

export class Toolchain {
  /**
   * @param {{ pack: Uint8Array, factories: Record<string, Function> }} opts
   *   pack: the LZMA-compressed compiler pack
   *   factories: Emscripten module factories keyed by tool name (cc1plus, avr-as, avr-ld, avr-objcopy)
   */
  constructor({ pack, factories }) {
    this.core = new CoreToolchain(pack);
    this.manifest = JSON.parse(this.core.manifestJson());
    this.factories = factories;
    this.modules = {};
  }

  // Compiles the tools' WebAssembly up front (the slow part on first use).
  async init() {
    await Promise.all(
      Object.keys(this.factories).map(async (tool) => {
        this.modules[tool] ??= await WebAssembly.compile(this.core.file(`/tools/${tool}.wasm`));
      }),
    );
  }

  async #instantiate(tool) {
    const output = [];
    const module = this.modules[tool];
    const mod = await this.factories[tool]({
      noInitialRun: true,
      // ld finds its default linker scripts in <program dir>/ldscripts/, so give every tool a fixed
      // location (otherwise Node uses the running script's path).
      thisProgram: "/" + tool,
      print: (l) => output.push(l),
      printErr: (l) => output.push(l),
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
        return {};
      },
    });
    return {
      writeFile(p, data) {
        mod.FS.mkdirTree(p.slice(0, p.lastIndexOf("/")) || "/");
        mod.FS.writeFile(p, data);
      },
      callMain(args) {
        try {
          return mod.callMain(args) ?? 0;
        } catch (e) {
          if (typeof e?.status === "number") return e.status;
          throw e;
        }
      },
      readFile(p) {
        try {
          return mod.FS.readFile(p);
        } catch {
          return undefined;
        }
      },
      output: () => output,
    };
  }

  /**
   * @param {{ files: { name: string, code: string }[], log?: (line: string) => void, keepAssembly?: boolean }} sketch
   *   files[0] is the main .ino; other .ino tabs, .h and .cpp files may follow
   * @returns {Promise<{ hex: string, image: Uint8Array, flash: number, ram: number, libraries: string[], warnings: object[], output: string, assembly: object[], timings: object }>}
   *   rejects with an Error named "CompileError" carrying `diagnostics` and `output`
   */
  async build({ files, log = () => {}, keepAssembly = false }) {
    await this.init();
    const tools = { instantiate: (tool) => this.#instantiate(tool), log, now: () => performance.now() };
    return this.core.build(files, tools, keepAssembly);
  }
}
