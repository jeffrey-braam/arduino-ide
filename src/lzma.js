// Decoder for .lzma files (`xz --format=lzma`), which is how the page's embedded data is
// compressed: about a third smaller than gzip. Follows the public-domain reference decoder
// (LzmaSpec.cpp in the LZMA SDK). The build writes the uncompressed size into the header.
export function unlzma(input) {
  const props = input[0];
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (props >= 225 || view.getUint32(9, true) === 0xffffffff) throw new Error("Unsupported compressed data");
  const lc = props % 9, lp = ((props / 9) | 0) % 5, pb = (props / 45) | 0;
  const size = view.getUint32(5, true) + view.getUint32(9, true) * 2 ** 32;
  const out = new Uint8Array(size);

  // Range decoder. The stream starts with a zero byte, then the first 4 bytes of the code.
  let ip = 14, range = 0xffffffff, code = 0;
  for (let i = 0; i < 4; i++) code = code * 256 + input[ip++];
  const bit = (probs, i) => {
    const p = probs[i];
    const bound = (range >>> 11) * p;
    let b = 0;
    if (code < bound) {
      range = bound;
      probs[i] = p + ((2048 - p) >> 5);
    } else {
      range -= bound;
      code -= bound;
      probs[i] = p - (p >> 5);
      b = 1;
    }
    if (range < 0x1000000) {
      range *= 256;
      code = code * 256 + input[ip++];
    }
    return b;
  };
  const direct = (n) => {
    let r = 0;
    while (n--) {
      range >>>= 1;
      r *= 2;
      if (code >= range) {
        code -= range;
        r++;
      }
      if (range < 0x1000000) {
        range *= 256;
        code = code * 256 + input[ip++];
      }
    }
    return r;
  };
  const tree = (probs, base, n) => {
    let m = 1;
    for (let i = 0; i < n; i++) m = (m << 1) | bit(probs, base + m);
    return m - (1 << n);
  };
  const reverse = (probs, base, n) => {
    let m = 1, r = 0;
    for (let i = 0; i < n; i++) {
      const b = bit(probs, base + m);
      m = (m << 1) | b;
      r |= b << i;
    }
    return r;
  };
  const probs = (n) => new Uint16Array(n).fill(1024);
  const lit = probs(0x300 << (lc + lp));
  const isMatch = probs(192), isRep = probs(12), isRepG0 = probs(12), isRepG1 = probs(12), isRepG2 = probs(12), isRep0Long = probs(192);
  const posSlot = probs(256), posDec = probs(115), align = probs(16);
  // Lengths: choice, choice2, then low (8 per posState), mid (8 per posState) and high trees.
  const matchLen = probs(514), repLen = probs(514);
  const length = (p, ps) => (!bit(p, 0) ? tree(p, 2 + ps * 8, 3) : !bit(p, 1) ? 8 + tree(p, 130 + ps * 8, 3) : 16 + tree(p, 258, 8));

  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, pos = 0;
  while (pos < size) {
    const ps = pos & pbMask;
    if (!bit(isMatch, (state << 4) + ps)) {
      const base = 0x300 * (((pos & lpMask) << lc) + ((pos ? out[pos - 1] : 0) >> (8 - lc)));
      let s = 1;
      if (state >= 7) {
        let match = out[pos - rep0 - 1];
        do {
          const mb = (match >> 7) & 1;
          match <<= 1;
          const b = bit(lit, base + ((1 + mb) << 8) + s);
          s = (s << 1) | b;
          if (mb !== b) break;
        } while (s < 0x100);
      }
      while (s < 0x100) s = (s << 1) | bit(lit, base + s);
      out[pos++] = s - 0x100;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (bit(isRep, state)) {
      if (!pos) throw new Error("Compressed data is damaged");
      if (!bit(isRepG0, state)) {
        if (!bit(isRep0Long, (state << 4) + ps)) {
          state = state < 7 ? 9 : 11;
          out[pos] = out[pos - rep0 - 1];
          pos++;
          continue;
        }
      } else {
        let dist;
        if (!bit(isRepG1, state)) dist = rep1;
        else {
          if (!bit(isRepG2, state)) dist = rep2;
          else {
            dist = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = dist;
      }
      len = length(repLen, ps);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      len = length(matchLen, ps);
      state = state < 7 ? 7 : 10;
      const slot = tree(posSlot, (len < 3 ? len : 3) << 6, 6);
      if (slot < 4) rep0 = slot;
      else {
        const n = (slot >> 1) - 1;
        rep0 = (2 | (slot & 1)) * 2 ** n;
        if (slot < 14) rep0 += reverse(posDec, rep0 - slot, n);
        else rep0 += direct(n - 4) * 16 + reverse(align, 0, 4);
      }
      if (rep0 >= pos) throw new Error("Compressed data is damaged");
    }
    const from = pos - rep0 - 1;
    const end = Math.min(pos + len + 2, size);
    if (rep0 + 1 >= end - pos) out.copyWithin(pos, from, from + end - pos);
    else for (let i = from; pos < end; ) out[pos++] = out[i++];
    pos = end;
  }
  return out;
}
