// Bundles src/ into a single self-contained dist/arduino-ide.html: a small boot script plus
// compressed packs (the app, and if prepared, the compiler and the examples; see embed.mjs).
// Usage: node build/build.mjs [--watch] [--no-compiler]
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compress, embed } from "./embed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => path.join(root, "src", p);
const outFile = path.join(root, "dist", "arduino-ide.html");
const packFile = path.join(root, "build/cache/compiler-pack.bin.lzma");
const examplesFile = path.join(root, "build/cache/examples.json.lzma");
const watch = process.argv.includes("--watch");
const withCompiler = !process.argv.includes("--no-compiler") && existsSync(packFile);
const withExamples = existsSync(examplesFile);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const date = new Date().toISOString().slice(0, 10);

if (!withCompiler) console.warn("Compiler pack not found; building without the compiler. Run: node build/prepare-compiler.mjs");
if (!withExamples) console.warn("Examples not found; building without them. Run: node build/prepare-examples.mjs");

const bundle = async (entry, options = {}) =>
  (await esbuild.build({ entryPoints: [src(entry)], bundle: true, format: "iife", minify: true, target: ["chrome100"], write: false, logLevel: "error", ...options }))
    .outputFiles[0].text;

// Emscripten glue references Node modules behind runtime checks that are false in a browser.
const workerSource = withCompiler
  ? await bundle("compiler/worker.js", { external: ["node:*", "module", "fs", "path", "crypto", "url", "worker_threads", "child_process"], supported: { "top-level-await": true } })
  : "";
// "</script" inside inline content would end the <script> element early; "<\/script" is equivalent in JS.
const bootJs = (await bundle("boot.js")).replace(/<\/(script)/gi, "<\\/$1");
// The large packs don't change between rebuilds, so they're encoded once.
const dataPacks = [withCompiler && embed("compiler-pack", readFileSync(packFile)), withExamples && embed("examples-pack", readFileSync(examplesFile))].filter(Boolean);

// About/licenses data: components and license texts (licenses/), the exact compiler sources
// (toolchain/out/SOURCES.md), and every npm package that ended up in the bundle.
function aboutData(metafile) {
  const licensesDir = path.join(root, "licenses");
  const { texts, components } = JSON.parse(readFileSync(path.join(licensesDir, "components.json"), "utf8"));
  for (const t of Object.values(texts)) t.text = readFileSync(path.join(licensesDir, t.file), "utf8");
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/node_modules\/((@[^/]+\/)?[^/]+)\//);
    if (!m || packages.has(m[1])) continue;
    const dir = path.join(root, "node_modules", m[1]);
    const meta = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const licenseFile = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    if (!licenseFile) throw new Error(`Bundled package ${m[1]} has no license file`);
    packages.set(m[1], { name: m[1], version: meta.version, license: meta.license, text: readFileSync(path.join(dir, licenseFile), "utf8") });
  }
  const sourcesFile = path.join(root, "toolchain/out/SOURCES.md");
  return {
    app: { version: pkg.version, date },
    components,
    texts,
    packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
    compilerSources: existsSync(sourcesFile) ? readFileSync(sourcesFile, "utf8") : "",
  };
}

async function assemble(js, metafile) {
  const packs = [embed("app-pack", compress(Buffer.from(js))), ...dataPacks, embed("about-pack", compress(Buffer.from(JSON.stringify(aboutData(metafile)))))];
  const [html, css] = await Promise.all([readFile(src("index.html"), "utf8"), readFile(src("styles.css"), "utf8")]);
  const out = html
    .replace("/*INLINE_CSS*/", () => css)
    .replace("<!--PACKS-->", () => packs.join("\n"))
    .replace("/*BOOT_JS*/", () => bootJs);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, out);
  const mb = (Buffer.byteLength(out) / 1048576).toFixed(1);
  console.log(`Built ${path.relative(root, outFile)} (${mb} MB${withCompiler ? ", with compiler" : ", no compiler"}${withExamples ? ", with examples" : ""})`);
}

const options = {
  entryPoints: [src("main.js")],
  outfile: path.join(root, "dist", "app.js"),
  bundle: true,
  format: "iife",
  minify: !watch,
  target: ["chrome100"],
  write: false,
  charset: "utf8",
  legalComments: "eof",
  metafile: true, // lists the bundled npm packages for the About tab
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_DATE__: JSON.stringify(date) },
  plugins: [
    {
      name: "compiler-worker-source",
      setup(build) {
        build.onResolve({ filter: /^compiler-worker-source$/ }, () => ({ path: "worker", namespace: "worker-src" }));
        build.onLoad({ filter: /.*/, namespace: "worker-src" }, () => ({ contents: workerSource, loader: "text" }));
      },
    },
    {
      name: "assemble-html",
      setup(build) {
        build.onEnd(async (result) => {
          if (!result.errors.length) await assemble(result.outputFiles[0].text, result.metafile);
        });
      },
    },
  ],
};

if (watch) {
  await (await esbuild.context(options)).watch();
  console.log("Watching src/ for changes…");
} else {
  await esbuild.build(options);
}
