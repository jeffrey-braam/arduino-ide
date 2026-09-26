// Bundles src/ into a single self-contained dist/arduino-ide.html.
// If build/cache/compiler-pack.bin.gz exists (see prepare-compiler.mjs), the compiler is embedded.
// Usage: node build/build.mjs [--watch] [--no-compiler]
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => path.join(root, "src", p);
const outFile = path.join(root, "dist", "arduino-ide.html");
const packFile = path.join(root, "build/cache/compiler-pack.bin.gz");
const watch = process.argv.includes("--watch");
const withCompiler = !process.argv.includes("--no-compiler") && existsSync(packFile);
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

// "</script" inside inline content would end the <script> element early; "<\/script" is equivalent in JS.
const escapeScript = (js) => js.replace(/<\/(script)/gi, "<\\/$1");

async function buildWorker() {
  if (!withCompiler) return "";
  const r = await esbuild.build({
    entryPoints: [src("compiler/worker.js")],
    bundle: true,
    format: "iife",
    minify: true,
    target: ["chrome100"],
    write: false,
    logLevel: "error",
    // Emscripten glue references Node modules behind runtime checks that are false in a browser.
    external: ["node:*", "module", "fs", "path", "crypto", "url", "worker_threads", "child_process"],
    supported: { "top-level-await": true },
  });
  return r.outputFiles[0].text;
}

const examplesFile = path.join(root, "build/cache/examples.json.gz");
const withExamples = existsSync(examplesFile);
let packBase64 = "";
let examplesBase64 = "";
const embed = (id, base64) => `<script type="application/octet-stream" id="${id}">${base64}</script>`;

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
    app: { version: pkg.version, date: new Date().toISOString().slice(0, 10) },
    components,
    texts,
    packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
    compilerSources: existsSync(sourcesFile) ? readFileSync(sourcesFile, "utf8") : "",
  };
}

async function assemble(js, metafile) {
  const aboutBase64 = gzipSync(JSON.stringify(aboutData(metafile)), { level: 9 }).toString("base64");
  const [html, css] = await Promise.all([readFile(src("index.html"), "utf8"), readFile(src("styles.css"), "utf8")]);
  const out = html
    .replace("/*INLINE_CSS*/", () => css)
    .replace("<!--COMPILER_PACK-->", () => (withCompiler ? embed("compiler-pack", packBase64) : ""))
    .replace("<!--EXAMPLES_PACK-->", () => (withExamples ? embed("examples-pack", examplesBase64) : ""))
    .replace("<!--ABOUT_PACK-->", () => embed("about-pack", aboutBase64))
    .replace("/*INLINE_JS*/", () => escapeScript(js));
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, out);
  const mb = (out.length / 1048576).toFixed(1);
  console.log(`Built ${path.relative(root, outFile)} (${mb} MB${withCompiler ? ", with compiler" : ", no compiler"}${withExamples ? ", with examples" : ""})`);
}

const workerSource = await buildWorker();
if (withCompiler) packBase64 = (await readFile(packFile)).toString("base64");
else console.warn("Compiler pack not found; building without the compiler. Run: node build/prepare-compiler.mjs");
if (withExamples) examplesBase64 = (await readFile(examplesFile)).toString("base64");
else console.warn("Examples not found; building without them. Run: node build/prepare-examples.mjs");

const plugins = [
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
];

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
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins,
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching src/ for changes…");
} else {
  await esbuild.build(options);
}
