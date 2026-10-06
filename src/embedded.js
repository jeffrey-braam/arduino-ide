// Data embedded in the page at build time: LZMA-compressed, then stored as text in
// <script type="application/octet-stream"> elements (see crates/build). Decoded by the Rust core.
import { decodeEmbedded, unpackText as unpack } from "#core";

// Returns the element's (still compressed) bytes and empties it so the large string can be freed.
export function takeEmbedded(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const bytes = decodeEmbedded(el.textContent);
  el.textContent = "";
  return bytes;
}

export function unpackText(id) {
  const el = document.getElementById(id);
  const text = unpack(el.textContent);
  el.textContent = "";
  return text;
}
