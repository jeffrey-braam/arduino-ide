//! Decoder for .lzma files (`xz --format=lzma`), which is how the page's embedded data is
//! compressed: about a third smaller than gzip. Follows the public-domain reference decoder
//! (LzmaSpec.cpp in the LZMA SDK). The build writes the uncompressed size into the header.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LzmaError {
    Unsupported,
    Damaged,
}

impl fmt::Display for LzmaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            LzmaError::Unsupported => "Unsupported compressed data",
            LzmaError::Damaged => "Compressed data is damaged",
        })
    }
}

impl std::error::Error for LzmaError {}

struct RangeDecoder<'a> {
    input: &'a [u8],
    ip: usize,
    range: u32,
    code: u32,
}

impl RangeDecoder<'_> {
    // Reading past the end yields zeros; the size check afterwards catches truncated data.
    fn next_byte(&mut self) -> u32 {
        let b = self.input.get(self.ip).copied().unwrap_or(0);
        self.ip += 1;
        b as u32
    }

    fn normalize(&mut self) {
        if self.range < 0x100_0000 {
            self.range <<= 8;
            self.code = (self.code << 8) | self.next_byte();
        }
    }

    fn bit(&mut self, probs: &mut [u16], i: usize) -> u32 {
        let p = probs[i] as u32;
        let bound = (self.range >> 11) * p;
        let b = if self.code < bound {
            self.range = bound;
            probs[i] = (p + ((2048 - p) >> 5)) as u16;
            0
        } else {
            self.range -= bound;
            self.code -= bound;
            probs[i] = (p - (p >> 5)) as u16;
            1
        };
        self.normalize();
        b
    }

    fn direct(&mut self, n: u32) -> u32 {
        let mut r = 0;
        for _ in 0..n {
            self.range >>= 1;
            r <<= 1;
            if self.code >= self.range {
                self.code -= self.range;
                r |= 1;
            }
            self.normalize();
        }
        r
    }

    fn tree(&mut self, probs: &mut [u16], base: usize, n: u32) -> u32 {
        let mut m = 1u32;
        for _ in 0..n {
            m = (m << 1) | self.bit(probs, base + m as usize);
        }
        m - (1 << n)
    }

    fn reverse(&mut self, probs: &mut [u16], base: usize, n: u32) -> u32 {
        let (mut m, mut r) = (1u32, 0u32);
        for i in 0..n {
            let b = self.bit(probs, base + m as usize);
            m = (m << 1) | b;
            r |= b << i;
        }
        r
    }

    // Lengths: choice, choice2, then low (8 per posState), mid (8 per posState) and high trees.
    fn length(&mut self, p: &mut [u16], ps: usize) -> u32 {
        if self.bit(p, 0) == 0 {
            self.tree(p, 2 + ps * 8, 3)
        } else if self.bit(p, 1) == 0 {
            8 + self.tree(p, 130 + ps * 8, 3)
        } else {
            16 + self.tree(p, 258, 8)
        }
    }
}

pub fn unlzma(input: &[u8]) -> Result<Vec<u8>, LzmaError> {
    if input.len() < 13 {
        return Err(LzmaError::Damaged);
    }
    let props = input[0] as u32;
    let u32_at = |i: usize| u32::from_le_bytes([input[i], input[i + 1], input[i + 2], input[i + 3]]);
    if props >= 225 || u32_at(9) == 0xffff_ffff {
        return Err(LzmaError::Unsupported);
    }
    let (lc, lp, pb) = (props % 9, (props / 9) % 5, props / 45);
    let size = u32_at(5) as u64 + ((u32_at(9) as u64) << 32);
    let size = usize::try_from(size).map_err(|_| LzmaError::Unsupported)?;
    let mut out = vec![0u8; size];

    // The stream starts with a zero byte, then the first 4 bytes of the code.
    let mut rc = RangeDecoder { input, ip: 14, range: 0xffff_ffff, code: 0 };
    for _ in 0..4 {
        rc.code = (rc.code << 8) | rc.next_byte();
    }

    let probs = |n: usize| vec![1024u16; n];
    let mut lit = probs(0x300 << (lc + lp));
    let mut is_match = probs(192);
    let (mut is_rep, mut is_rep_g0, mut is_rep_g1, mut is_rep_g2) = (probs(12), probs(12), probs(12), probs(12));
    let mut is_rep0_long = probs(192);
    let (mut pos_slot, mut pos_dec, mut align) = (probs(256), probs(115), probs(16));
    let (mut match_len, mut rep_len) = (probs(514), probs(514));

    let pb_mask = (1usize << pb) - 1;
    let lp_mask = (1usize << lp) - 1;
    let mut state = 0usize;
    let (mut rep0, mut rep1, mut rep2, mut rep3) = (0usize, 0usize, 0usize, 0usize);
    let mut pos = 0usize;
    while pos < size {
        let ps = pos & pb_mask;
        if rc.bit(&mut is_match, (state << 4) + ps) == 0 {
            let prev = if pos > 0 { out[pos - 1] as usize } else { 0 };
            let base = 0x300 * (((pos & lp_mask) << lc) + (prev >> (8 - lc)));
            let mut s = 1usize;
            if state >= 7 {
                let mut matched = out[pos - rep0 - 1] as usize;
                loop {
                    let mb = (matched >> 7) & 1;
                    matched <<= 1;
                    let b = rc.bit(&mut lit, base + ((1 + mb) << 8) + s) as usize;
                    s = (s << 1) | b;
                    if mb != b || s >= 0x100 {
                        break;
                    }
                }
            }
            while s < 0x100 {
                s = (s << 1) | rc.bit(&mut lit, base + s) as usize;
            }
            out[pos] = (s - 0x100) as u8;
            pos += 1;
            state = if state < 4 { 0 } else if state < 10 { state - 3 } else { state - 6 };
            continue;
        }
        let len;
        if rc.bit(&mut is_rep, state) == 1 {
            if pos == 0 {
                return Err(LzmaError::Damaged);
            }
            if rc.bit(&mut is_rep_g0, state) == 0 {
                if rc.bit(&mut is_rep0_long, (state << 4) + ps) == 0 {
                    state = if state < 7 { 9 } else { 11 };
                    out[pos] = out[pos - rep0 - 1];
                    pos += 1;
                    continue;
                }
            } else {
                let dist;
                if rc.bit(&mut is_rep_g1, state) == 0 {
                    dist = rep1;
                } else {
                    if rc.bit(&mut is_rep_g2, state) == 0 {
                        dist = rep2;
                    } else {
                        dist = rep3;
                        rep3 = rep2;
                    }
                    rep2 = rep1;
                }
                rep1 = rep0;
                rep0 = dist;
            }
            len = rc.length(&mut rep_len, ps);
            state = if state < 7 { 8 } else { 11 };
        } else {
            rep3 = rep2;
            rep2 = rep1;
            rep1 = rep0;
            len = rc.length(&mut match_len, ps);
            state = if state < 7 { 7 } else { 10 };
            let slot = rc.tree(&mut pos_slot, (len.min(3) as usize) << 6, 6);
            let dist: u64 = if slot < 4 {
                slot as u64
            } else {
                let n = (slot >> 1) - 1;
                let base = ((2 | (slot & 1)) as u64) << n;
                if slot < 14 {
                    base + rc.reverse(&mut pos_dec, (base - slot as u64) as usize, n) as u64
                } else {
                    base + ((rc.direct(n - 4) as u64) << 4) + rc.reverse(&mut align, 0, 4) as u64
                }
            };
            if dist >= pos as u64 {
                return Err(LzmaError::Damaged);
            }
            rep0 = dist as usize;
        }
        if rep0 >= pos {
            return Err(LzmaError::Damaged);
        }
        let from = pos - rep0 - 1;
        let end = (pos + len as usize + 2).min(size);
        let count = end - pos;
        if rep0 + 1 >= count {
            out.copy_within(from..from + count, pos);
        } else {
            for i in 0..count {
                out[pos + i] = out[from + i];
            }
        }
        pos = end;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // `xz --format=lzma` output of sample.txt. xz marks the size as unknown, so patch it in as the
    // build does.
    fn sample() -> (Vec<u8>, Vec<u8>) {
        let text = include_bytes!("../testdata/sample.txt").to_vec();
        let mut packed = include_bytes!("../testdata/sample.lzma").to_vec();
        packed[5..13].copy_from_slice(&(text.len() as u64).to_le_bytes());
        (text, packed)
    }

    #[test]
    fn decodes_xz_output() {
        let (text, packed) = sample();
        assert_eq!(unlzma(&packed).unwrap(), text);
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(unlzma(&[0xff; 20]), Err(LzmaError::Unsupported));
        assert_eq!(unlzma(&[1, 2, 3]), Err(LzmaError::Damaged));
    }
}
