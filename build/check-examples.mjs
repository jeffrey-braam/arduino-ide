// Compiles sketches with the in-browser toolchain (in Node), for `cargo aide prepare-examples`.
// Usage: node build/check-examples.mjs <in.json> <out.json>
//   in.json: [[{ name, code }, ...], ...]   out.json: [true, false, ...] (whether each compiles)
import fs from "node:fs";
import { loadToolchain } from "./node-toolchain.mjs";

const [input, output] = process.argv.slice(2);
const sketches = JSON.parse(fs.readFileSync(input, "utf8"));
const tc = loadToolchain();
const results = [];
for (const files of sketches) {
  try {
    await tc.build({ files });
    results.push(true);
  } catch {
    results.push(false);
  }
}
fs.writeFileSync(output, JSON.stringify(results));
