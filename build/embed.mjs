// Packs data into the page: compressed with LZMA (src/lzma.js decodes it), then written as text
// (src/embedded.js decodes it). Compressing needs xz from XZ Utils, which Git for Windows includes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const XZ =
  process.env.XZ ||
  (process.platform === "win32" && ["C:/Program Files/Git/mingw64/bin/xz.exe", "C:/Program Files/Git/usr/bin/xz.exe"].find(existsSync)) ||
  "xz";

export function compress(data) {
  const mib = Math.max(1, Math.ceil(data.length / 2 ** 20));
  const out = execFileSync(XZ, ["--format=lzma", `--lzma1=preset=9e,dict=${mib}MiB`, "-c"], { input: data, maxBuffer: 1 << 30 });
  // xz marks the size as unknown; the decoder allocates its output from it.
  out.writeUInt32LE(data.length % 2 ** 32, 5);
  out.writeUInt32LE(Math.floor(data.length / 2 ** 32), 9);
  return out;
}

// Text is denser than base64 (8 bytes per 7 bits of data instead of 8 per 6). Each character
// carries 7 bits, except the three values the HTML parser would change or that could end the
// <script> element (NUL, CR and "<"): those become a 2-byte UTF-8 character that also carries the
// next 7 bits. Keep UNSAFE in step with src/embedded.js.
const UNSAFE = [0, 13, 60];

export function encodeText(bytes) {
  const groups = new Uint8Array(Math.ceil((bytes.length * 8) / 7));
  let acc = 0, bits = 0, n = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0x7fff;
    bits += 8;
    while (bits >= 7) groups[n++] = (acc >> (bits -= 7)) & 127;
  }
  if (bits) groups[n++] = (acc << (7 - bits)) & 127;
  const codes = new Uint16Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const k = UNSAFE.indexOf(groups[i]);
    if (k < 0) codes[m++] = groups[i];
    else if (i + 1 < n) codes[m++] = 128 + (k << 7) + groups[++i];
    else codes[m++] = 128 + ((k + 3) << 7);
  }
  let text = "";
  for (let i = 0; i < m; i += 8192) text += String.fromCharCode(...codes.subarray(i, Math.min(i + 8192, m)));
  return text;
}

export const embed = (id, compressed) => `<script type="application/octet-stream" id="${id}">${encodeText(compressed)}</script>`;
