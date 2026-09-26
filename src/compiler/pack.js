// A minimal archive format for the compiler's files:
//   "AIDEPAK1" | u32 LE header length | header JSON { manifest, files: [[path, offset, size], ...] } | data
const MAGIC = "AIDEPAK1";

export function writePack(files, manifest) {
  const entries = [];
  let offset = 0;
  for (const [p, data] of files) {
    entries.push([p, offset, data.length]);
    offset += data.length;
  }
  const header = new TextEncoder().encode(JSON.stringify({ manifest, files: entries }));
  const out = new Uint8Array(MAGIC.length + 4 + header.length + offset);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(MAGIC.length, header.length, true);
  out.set(header, MAGIC.length + 4);
  let pos = MAGIC.length + 4 + header.length;
  for (const [, data] of files) {
    out.set(data, pos);
    pos += data.length;
  }
  return out;
}

// Returns { manifest, files: Map<path, Uint8Array> }; file contents are views into `bytes`.
export function readPack(bytes) {
  const magic = new TextDecoder().decode(bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error("Compiler data is damaged (bad header)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(MAGIC.length, true);
  const start = MAGIC.length + 4;
  const { manifest, files } = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + headerLen)));
  const base = start + headerLen;
  const map = new Map();
  for (const [p, offset, size] of files) map.set(p, bytes.subarray(base + offset, base + offset + size));
  return { manifest, files: map };
}
