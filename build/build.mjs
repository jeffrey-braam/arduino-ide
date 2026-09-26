// Bundles src/ into a single self-contained dist/arduino-ide.html.
// Usage: node build/build.mjs [--watch]
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => path.join(root, "src", p);
const outFile = path.join(root, "dist", "arduino-ide.html");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

async function assemble(js) {
  const [html, css] = await Promise.all([readFile(src("index.html"), "utf8"), readFile(src("styles.css"), "utf8")]);
  // "</script" inside the bundle would end the inline <script> early; "<\/script" is equivalent in JS.
  const safeJs = js.replace(/<\/(script)/gi, "<\\/$1");
  const out = html
    .replace("/*INLINE_CSS*/", () => css)
    .replace("/*INLINE_JS*/", () => safeJs);
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, out);
  console.log(`Built ${path.relative(root, outFile)} (${(out.length / 1024).toFixed(0)} KB)`);
}

const assemblePlugin = {
  name: "assemble-html",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await assemble(result.outputFiles[0].text);
    });
  },
};

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
  plugins: [assemblePlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching src/ for changes…");
} else {
  await esbuild.build(options);
}
