// Bundles src/ into a single self-contained dist/arduino-ide.html.
// If build/cache/compiler-pack.bin.gz exists (see prepare-compiler.mjs), the compiler is embedded.
// Usage: node build/build.mjs [--watch] [--no-compiler]
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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

async function assemble(js) {
  const [html, css] = await Promise.all([readFile(src("index.html"), "utf8"), readFile(src("styles.css"), "utf8")]);
  const out = html
    .replace("/*INLINE_CSS*/", () => css)
    .replace("<!--COMPILER_PACK-->", () => (withCompiler ? embed("compiler-pack", packBase64) : ""))
    .replace("<!--EXAMPLES_PACK-->", () => (withExamples ? embed("examples-pack", examplesBase64) : ""))
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
        if (!result.errors.length) await assemble(result.outputFiles[0].text);
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
