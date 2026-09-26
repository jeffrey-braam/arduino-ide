// Data embedded in the page at build time: LZMA-compressed, then stored as text in
// <script type="application/octet-stream"> elements (see build/embed.mjs).
import { unlzma } from "./lzma.js";

const UNSAFE = [0, 13, 60]; // same as build/embed.mjs

export function decodeText(text) {
  let groups = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 128 && c < 512) groups++; // an unsafe value plus the next 7 bits
  }
  const out = new Uint8Array((groups * 7) >> 3);
  let acc = 0, bits = 0, pos = 0;
  const put = (v) => {
    acc = ((acc << 7) | v) & 0x7fff;
    bits += 7;
    if (bits >= 8) out[pos++] = acc >> (bits -= 8);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) put(c);
    else {
      const k = (c >> 7) - 1;
      put(UNSAFE[k % 3]);
      if (k < 3) put(c & 127);
    }
  }
  return out;
}

// Returns the element's (still compressed) bytes and empties it so the large string can be freed.
export function takeEmbedded(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const bytes = decodeText(el.textContent);
  el.textContent = "";
  return bytes;
}

export const unpackText = (id) => new TextDecoder().decode(unlzma(takeEmbedded(id)));
