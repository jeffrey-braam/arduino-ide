// Parses Intel HEX text into a flat flash image (gaps filled with 0xFF, erased flash).
export class HexError extends Error {}

export function parseIntelHex(text) {
  const chunks = [];
  let base = 0;
  let end = 0;
  let sawEof = false;
  const lines = text.split(/\r?\n/);

  for (let n = 0; n < lines.length && !sawEof; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    const where = "Line " + (n + 1);
    if (line[0] !== ":") throw new HexError(where + ": expected a line starting with ':'");
    const body = line.slice(1);
    if (body.length % 2 || !/^[0-9a-fA-F]+$/.test(body)) throw new HexError(where + ": not valid hex digits");
    const bytes = new Uint8Array(body.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(body.substr(i * 2, 2), 16);
    if (bytes.length < 5 || bytes.length !== bytes[0] + 5) throw new HexError(where + ": wrong record length");
    if (bytes.reduce((a, b) => a + b, 0) & 0xff) throw new HexError(where + ": checksum mismatch");

    const len = bytes[0];
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + len);
    switch (type) {
      case 0x00:
        chunks.push({ addr: base + addr, data });
        end = Math.max(end, base + addr + len);
        break;
      case 0x01:
        sawEof = true;
        break;
      case 0x02:
        base = ((data[0] << 8) | data[1]) * 16;
        break;
      case 0x04:
        base = ((data[0] << 8) | data[1]) * 65536;
        break;
      case 0x03:
      case 0x05:
        break; // start addresses; irrelevant for flashing
      default:
        throw new HexError(where + ": unknown record type " + type);
    }
  }
  if (!sawEof) throw new HexError("File is incomplete (no end-of-file record)");
  if (!chunks.length) throw new HexError("File contains no program data");
  if (end > 16 * 1024 * 1024) throw new HexError("Program is far too large for this board");

  const image = new Uint8Array(end).fill(0xff);
  for (const c of chunks) image.set(c.data, c.addr);
  return image;
}
