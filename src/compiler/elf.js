// Reads section sizes from a 32-bit little-endian ELF file (what avr-ld produces) to report
// flash and RAM use like the Arduino IDE: flash = .text + .data, RAM = .data + .bss + .noinit.
export function elfSectionSizes(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 0x7f454c46) throw new Error("not an ELF file");
  const shoff = v.getUint32(0x20, true);
  const shentsize = v.getUint16(0x2e, true);
  const shnum = v.getUint16(0x30, true);
  const shstrndx = v.getUint16(0x32, true);
  const sec = (i) => {
    const o = shoff + i * shentsize;
    return { name: v.getUint32(o, true), offset: v.getUint32(o + 16, true), size: v.getUint32(o + 20, true) };
  };
  const strtab = sec(shstrndx);
  const nameAt = (off) => {
    let s = "";
    for (let p = strtab.offset + off; bytes[p]; p++) s += String.fromCharCode(bytes[p]);
    return s;
  };
  const sizes = {};
  for (let i = 0; i < shnum; i++) {
    const s = sec(i);
    sizes[nameAt(s.name)] = s.size;
  }
  return sizes;
}

export function memoryUsage(elf) {
  const s = elfSectionSizes(elf);
  const g = (n) => s[n] || 0;
  return { flash: g(".text") + g(".data"), ram: g(".data") + g(".bss") + g(".noinit") };
}
