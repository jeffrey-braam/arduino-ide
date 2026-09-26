// Data embedded in the page at build time as base64 inside <script type="application/octet-stream">.
export function decodeBase64(text) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(text.trim());
  const bin = atob(text.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Returns the element's bytes and empties it so the large string can be freed.
export function takeEmbedded(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  const bytes = decodeBase64(el.textContent);
  el.textContent = "";
  return bytes;
}

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
