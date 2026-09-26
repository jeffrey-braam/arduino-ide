// Runs the WebAssembly GCC toolchain (cc1plus -> as -> ld -> objcopy) on a sketch.
// Works in a browser worker and in Node. Each tool run gets a fresh Emscripten instance with an
// in-memory filesystem; the compiled WebAssembly modules are reused between runs.
import { preprocessSketch, findIncludes } from "./preprocess.js";
import { memoryUsage } from "./elf.js";
import { parseIntelHex } from "../upload/intelhex.js";

export class CompileError extends Error {
  constructor(message, diagnostics = [], output = "") {
    super(message);
    this.diagnostics = diagnostics;
    this.output = output;
  }
}

const DEFINES = ["-D__AVR_ATmega328P__", "-D__AVR_DEVICE_NAME__=atmega328p", "-DF_CPU=16000000L", "-DARDUINO=10607", "-DARDUINO_AVR_UNO", "-DARDUINO_ARCH_AVR"];
// Same as `avr-g++ -mmcu=atmega328p` passes to cc1plus with the Arduino platform flags (no -flto).
const CC1PLUS_FLAGS = ["-quiet", "-imultilib", "avr5", "-mn-flash=1", "-mno-skip-bug", "-mmcu=avr5", "-Os", "-Wno-error=narrowing", "-std=gnu++11", "-fpermissive", "-fno-exceptions", "-ffunction-sections", "-fdata-sections", "-fno-threadsafe-statics", "-fno-rtti", "-fno-enforce-eh-specs", "-fdiagnostics-color=never"];
const SYSTEM_INCLUDES = ["/sysroot/gcc/include", "/sysroot/gcc/include-fixed", "/sysroot/avr/include"];

// cc1plus messages look like: Blink.ino:12:5: error: 'foo' was not declared in this scope
const DIAG = /^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/;

// Messages about the student's own files (not library internals), for editor markers.
export function parseDiagnostics(lines, fileNames) {
  const out = [];
  for (const l of lines) {
    const m = l.match(DIAG);
    const file = m && m[1].split("/").pop();
    if (m && fileNames.has(file)) out.push({ file, line: +m[2], column: +m[3], severity: m[4] === "fatal error" ? "error" : m[4], message: m[5] });
  }
  return out;
}

const INO = /\.ino$/i;
const HEADER = /\.(h|hh|hpp|hxx|inc|tpp)$/i;
const CPP = /\.(cpp|cc|cxx)$/i;

export class Toolchain {
  /**
   * @param {{ files: Map<string, Uint8Array>, manifest: object, factories: Record<string, Function> }} opts
   *   factories: Emscripten module factories keyed by tool name (cc1plus, avr-as, avr-ld, avr-objcopy)
   */
  constructor({ files, manifest, factories }) {
    this.files = files;
    this.manifest = manifest;
    this.factories = factories;
    this.modules = {};
    this.headerFiles = [...files.keys()].filter((p) => p.startsWith("/sysroot/") || p.startsWith("/arduino/") || p.startsWith("/libraries/"));
    this.libraries = manifest.libraries;
  }

  // Compiles the tools' WebAssembly up front (the slow part on first use).
  async init() {
    await Promise.all(
      Object.keys(this.factories).map(async (tool) => {
        this.modules[tool] ??= await WebAssembly.compile(this.files.get(`/tools/${tool}.wasm`));
      }),
    );
  }

  async #run(tool, args, inputs, outputPath) {
    const stderr = [];
    const module = this.modules[tool];
    const mod = await this.factories[tool]({
      noInitialRun: true,
      // ld finds its default linker scripts in <program dir>/ldscripts/, so give every tool a fixed
      // location (otherwise Node uses the running script's path).
      thisProgram: "/" + tool,
      print: (l) => stderr.push(l),
      printErr: (l) => stderr.push(l),
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
        return {};
      },
    });
    for (const [p, data] of inputs) {
      mod.FS.mkdirTree(p.slice(0, p.lastIndexOf("/")) || "/");
      mod.FS.writeFile(p, data);
    }
    let status = 0;
    try {
      status = mod.callMain(args) ?? 0;
    } catch (e) {
      if (typeof e?.status === "number") status = e.status;
      else throw e;
    }
    let output = null;
    try {
      output = outputPath ? mod.FS.readFile(outputPath) : null;
    } catch {}
    return { status, stderr, output };
  }

  // Libraries needed by the sketch's #includes, plus their dependencies.
  resolveLibraries(includes) {
    const byHeader = new Map();
    for (const lib of this.libraries) for (const h of lib.headers) if (!byHeader.has(h)) byHeader.set(h, lib);
    const picked = new Map();
    const add = (lib) => {
      if (picked.has(lib.name)) return;
      picked.set(lib.name, lib);
      for (const d of lib.deps) add(this.libraries.find((l) => l.name === d));
    };
    for (const inc of includes) {
      const lib = byHeader.get(inc.split("/").pop());
      if (lib) add(lib);
    }
    return [...picked.values()];
  }

  /**
   * @param {{ files: { name: string, code: string }[], log?: (line: string) => void }} sketch
   *   files[0] is the main .ino; other .ino tabs, .h and .cpp files may follow
   * @returns {Promise<{ hex: string, image: Uint8Array, flash: number, ram: number, libraries: string[], timings: object, warnings: object[] }>}
   */
  async build({ files, log = () => {}, keepAssembly = false }) {
    await this.init();
    const t = { start: performance.now() };
    const [main, ...rest] = files;
    const unsupported = rest.filter((f) => !INO.test(f.name) && !HEADER.test(f.name) && !CPP.test(f.name));
    if (unsupported.length) throw new CompileError(`Can't compile ${unsupported.map((f) => f.name).join(", ")}: only .ino, .h and .cpp files are supported.`);

    const inos = [main, ...rest.filter((f) => INO.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))];
    const cppTabs = rest.filter((f) => CPP.test(f.name));
    const names = new Set(files.map((f) => f.name));
    const { cpp } = preprocessSketch(inos);
    // A header the sketch has its own copy of (a tab) is used instead of a library, as in the
    // Arduino IDE, so that library isn't linked in.
    const ownFiles = new Set(files.map((f) => f.name.toLowerCase()));
    const includes = files.flatMap((f) => findIncludes(f.code)).filter((inc) => !ownFiles.has(inc.split("/").pop().toLowerCase()));
    const libs = this.resolveLibraries(includes);
    if (libs.length) log("Using libraries: " + libs.map((l) => `${l.displayName} ${l.version}`).join(", "));

    const includeArgs = [
      ...SYSTEM_INCLUDES.flatMap((d) => ["-isystem", d]),
      "-I", "/build/sketch", "-I", "/arduino/core", "-I", "/arduino/variant",
      ...libs.flatMap((l) => l.includeDirs.flatMap((d) => ["-I", d])),
    ];
    const enc = new TextEncoder();
    const sketchFiles = rest.filter((f) => !INO.test(f.name)).map((f) => ["/build/sketch/" + f.name, enc.encode(f.code)]);
    const inputs = [...this.headerFiles.map((p) => [p, this.files.get(p)]), ...sketchFiles];

    // 1-2. Compile each translation unit to assembly, then assemble it.
    const units = [{ path: `/build/sketch/${main.name}.cpp`, data: enc.encode(cpp) }, ...cppTabs.map((f) => ({ path: "/build/sketch/" + f.name, data: enc.encode(f.code) }))];
    const objects = [];
    const assembly = []; // kept only when asked for, to compare against the native compiler
    const diagnostics = [];
    const output = [];
    for (const [i, u] of units.entries()) {
      const base = u.path.split("/").pop();
      const cc = await this.#run(
        "cc1plus",
        [...CC1PLUS_FLAGS, ...DEFINES, ...includeArgs, u.path, "-dumpbase", base, "-auxbase-strip", "/build/out.s", "-o", "/build/out.s"],
        [...inputs, [u.path, u.data]],
        "/build/out.s",
      );
      diagnostics.push(...parseDiagnostics(cc.stderr, names));
      output.push(...cc.stderr);
      if (cc.status !== 0 || !cc.output) throw new CompileError("Compilation failed.", diagnostics, output.join("\n"));

      const as = await this.#run("avr-as", ["-mmcu=avr5", "-mno-skip-bug", "-o", "/build/out.o", "/build/out.s"], [["/build/out.s", cc.output]], "/build/out.o");
      output.push(...as.stderr);
      if (as.status !== 0 || !as.output) throw new CompileError("Assembling failed.", diagnostics, output.join("\n"));
      objects.push([`/build/unit${i}.o`, as.output]);
      if (keepAssembly) assembly.push({ unit: base, text: new TextDecoder().decode(cc.output), source: new TextDecoder().decode(u.data) });
    }
    t.compile = t.assemble = performance.now();
    const warnings = diagnostics.filter((d) => d.severity === "warning");

    // 3. Link: same as `avr-gcc -mmcu=atmega328p -Wl,--gc-sections ... -lm`
    const libObjects = libs.flatMap((l) => l.objects);
    const linkInputs = [
      ...objects,
      ...[...this.files].filter(([p]) => p.startsWith("/libs/") || p.startsWith("/ldscripts/")),
      ...libObjects.map((p) => [p, this.files.get(p)]),
    ];
    const ld = await this.#run(
      "avr-ld",
      ["-mavr5", "-Tdata", "0x800100", "-o", "/build/sketch.elf", "/libs/crtatmega328p.o", "-L/libs", "--gc-sections", ...objects.map(([p]) => p), ...libObjects, "/libs/core.a", "-lm", "--start-group", "-lgcc", "-lm", "-lc", "-latmega328p", "--end-group"],
      linkInputs,
      "/build/sketch.elf",
    );
    output.push(...ld.stderr);
    if (ld.status !== 0 || !ld.output) throw new CompileError("Linking failed.", diagnostics, output.join("\n"));
    t.link = performance.now();

    // 4. Convert to Intel HEX
    const oc = await this.#run("avr-objcopy", ["-O", "ihex", "-R", ".eeprom", "/build/sketch.elf", "/build/sketch.hex"], [["/build/sketch.elf", ld.output]], "/build/sketch.hex");
    if (oc.status !== 0 || !oc.output) throw new CompileError("Creating the .hex file failed.", [], oc.stderr.join("\n"));
    t.end = performance.now();

    const hex = new TextDecoder().decode(oc.output);
    const { flash, ram } = memoryUsage(ld.output);
    return {
      hex,
      image: parseIntelHex(hex),
      flash,
      ram,
      libraries: libs.map((l) => l.name),
      warnings,
      output: output.join("\n"),
      assembly,
      timings: {
        compileMs: Math.round(t.compile - t.start),
        linkMs: Math.round(t.link - t.compile),
        hexMs: Math.round(t.end - t.link),
        totalMs: Math.round(t.end - t.start),
      },
    };
  }
}
