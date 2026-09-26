// Turns a .ino sketch into C++ the way the Arduino IDE does: adds `#include <Arduino.h>`,
// declares functions ahead of use (so they can be called before they're defined), and keeps
// compiler messages pointing at the student's line numbers via #line.

// Replaces comments, and optionally string/char literals, with spaces (newlines kept) so that
// positions and line numbers still match the original text.
export function mask(code, { strings = true } = {}) {
  const out = code.split("");
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      if (strings) blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join("");
}

const lineAt = (text, index) => {
  let line = 1;
  for (let k = 0; k < index; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
};

export function findIncludes(code) {
  const masked = mask(code, { strings: false });
  return [...masked.matchAll(/^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\n]+)[>"]/gm)].map((m) => m[1].trim());
}

const NOT_FUNCTIONS = new Set(["if", "for", "while", "switch", "catch", "return", "sizeof", "do", "else"]);
// return type, name, (args) — args may contain one level of parentheses, e.g. function pointers
const SIGNATURE = /^([A-Za-z_][\w\s\*&:<>,]*?[\s\*&])([A-Za-z_]\w*)\s*\(([^;{}()]*(?:\([^;{}()]*\)[^;{}()]*)*)\)\s*(const\s*)?$/;

// Finds functions defined at file scope, and functions already declared there.
export function findFunctions(code) {
  // Preprocessor lines are blanked too: they can contain braces or look like signatures.
  const masked = mask(code).replace(/^[ \t]*#.*(\\\r?\n.*)*$/gm, (m) => m.replace(/[^\n]/g, " "));
  const defs = [];
  const declared = new Set();
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "{") {
      if (depth === 0) {
        const raw = masked.slice(segStart, i);
        const sig = raw.trim().replace(/\s+/g, " ");
        const m = sig.match(SIGNATURE);
        const start = segStart + raw.search(/\S/);
        // A signature split by #if/#endif lines (e.g. board-specific attributes) can't be copied
        // safely into a declaration, so those are left alone.
        const spansDirective = /^[ \t]*#/m.test(code.slice(start, i));
        if (m && !spansDirective && !NOT_FUNCTIONS.has(m[2]) && !/\b(class|struct|union|enum|namespace|template|typedef|operator)\b/.test(sig) && !sig.includes("=") && !m[1].includes("::")) {
          defs.push({ name: m[2], signature: code.slice(start, i).trim().replace(/\s+/g, " "), line: lineAt(code, start), args: m[3] });
        }
      }
      depth++;
      segStart = i + 1;
    } else if (c === "}") {
      depth = Math.max(0, depth - 1);
      segStart = i + 1;
    } else if (c === ";" && depth === 0) {
      const sig = masked.slice(segStart, i).trim().replace(/\s+/g, " ");
      const m = sig.match(SIGNATURE);
      if (m) declared.add(m[2]);
      segStart = i + 1;
    }
  }
  return { defs, declared };
}

/**
 * @param {{ name: string, code: string }[]} inoFiles main sketch first; other tabs follow, as in
 *   the Arduino IDE (which appends the other .ino tabs in alphabetical order)
 */
export function preprocessSketch(inoFiles) {
  // Merge the tabs, remembering where every merged line came from.
  const lines = [];
  const origin = [];
  for (const f of inoFiles) {
    const fileLines = f.code.replace(/\r\n?/g, "\n").split("\n");
    lines.push(`#line 1 ${JSON.stringify(f.name)}`);
    origin.push(null);
    fileLines.forEach((l, i) => {
      lines.push(l);
      origin.push({ file: f.name, line: i + 1 });
    });
  }
  const merged = lines.join("\n");
  const { defs, declared } = findFunctions(merged);
  const where = (mergedLine) => origin[mergedLine - 1];
  const lineDirective = (o) => `#line ${o.line} ${JSON.stringify(o.file)}`;

  // Functions with default arguments can't be declared twice with defaults; the student must
  // define those before use, as in the Arduino IDE.
  const protos = defs.filter((d) => !declared.has(d.name) && !d.args.includes("="));
  const seen = new Set();
  const unique = protos.filter((d) => !seen.has(d.signature) && seen.add(d.signature));

  let out = "#include <Arduino.h>\n";
  if (!unique.length) return { cpp: out + merged + "\n", prototypes: [] };

  const insertAt = defs[0].line; // before the first function definition
  out += lines.slice(0, insertAt - 1).join("\n") + "\n";
  for (const d of unique) out += lineDirective(where(d.line)) + "\n" + d.signature + ";\n";
  out += lineDirective(where(insertAt)) + "\n" + lines.slice(insertAt - 1).join("\n") + "\n";
  return { cpp: out, prototypes: unique.map((d) => d.signature + ";") };
}
