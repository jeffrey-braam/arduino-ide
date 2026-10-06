//! Binary data written into the page as text. Text is denser than base64 (8 bytes per 7 bits of
//! data instead of 8 per 6). Each character carries 7 bits, except the three values the HTML
//! parser would change or that could end the <script> element (NUL, CR and "<"): those become a
//! 2-byte UTF-8 character that also carries the next 7 bits.

const UNSAFE: [u8; 3] = [0, 13, 60];

pub fn encode_text(bytes: &[u8]) -> String {
    let mut groups = Vec::with_capacity(bytes.len() * 8 / 7 + 1);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &b in bytes {
        acc = ((acc << 8) | b as u32) & 0x7fff;
        bits += 8;
        while bits >= 7 {
            bits -= 7;
            groups.push(((acc >> bits) & 127) as u8);
        }
    }
    if bits > 0 {
        groups.push(((acc << (7 - bits)) & 127) as u8);
    }
    let mut text = String::with_capacity(groups.len() + groups.len() / 32);
    let mut i = 0;
    while i < groups.len() {
        let code = match UNSAFE.iter().position(|&u| u == groups[i]) {
            None => groups[i] as u32,
            Some(k) if i + 1 < groups.len() => {
                i += 1;
                128 + ((k as u32) << 7) + groups[i] as u32
            }
            // An unsafe value in the last group: there's no next group to carry.
            Some(k) => 128 + ((k as u32 + 3) << 7),
        };
        text.push(char::from_u32(code).expect("codes are below 0x400"));
        i += 1;
    }
    text
}

pub fn decode_text(text: &str) -> Vec<u8> {
    let groups: usize = text.chars().map(|c| if (128..512).contains(&(c as u32)) { 2 } else { 1 }).sum();
    let mut out = Vec::with_capacity(groups * 7 / 8);
    let (mut acc, mut bits) = (0u32, 0u32);
    let mut put = |v: u32| {
        acc = ((acc << 7) | v) & 0x7fff;
        bits += 7;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    };
    for c in text.chars() {
        let c = c as u32;
        if c < 128 {
            put(c);
        } else {
            let k = (c >> 7) as usize - 1;
            put(UNSAFE[k % 3] as u32);
            if k < 3 {
                put(c & 127);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::random_bytes;

    #[test]
    fn round_trips_and_never_contains_nul_cr_or_lt() {
        let mut samples: Vec<Vec<u8>> = vec![vec![], vec![0, 13, 60], vec![60; 1000], b"void setup() {}\nvoid loop() {}\n".repeat(500), random_bytes(100_000, 1)];
        samples.extend((0..300).map(|n| random_bytes(n, n as u64 + 2)));
        for bytes in samples {
            let text = encode_text(&bytes);
            assert!(!text.contains(['\0', '\r', '<']));
            assert_eq!(decode_text(&text), bytes);
        }
    }
}
