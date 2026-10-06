//! Binary data written into the page. The page is declared windows-1252, so every byte of the
//! file is one character and data costs almost nothing extra: only the bytes the HTML parser
//! would change or that could end the <script> element (NUL, CR and "<"), plus the escape byte
//! itself, are written as two bytes. Base64 would cost a third more.
//!
//! The browser hands the element's text back as characters; most are the byte's own code point,
//! but bytes 0x80-0x9F become the typographic characters of windows-1252 (0x80 is "€"), which
//! `decode_text` maps back.

const ESC: u8 = 0x7f;
// Bytes written as ESC + '0', '1', '2', '3'.
const ESCAPED: [u8; 4] = [0x00, b'\r', b'<', ESC];

// windows-1252 bytes 0x80-0x9F as the browser decodes them (WHATWG Encoding standard). The five
// unassigned bytes decode to the C1 control with the same value.
const CP1252_HIGH: [u16; 32] = [
    0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, //
    0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

/// The bytes to put inside the <script> element.
pub fn encode(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + bytes.len() / 50);
    for &b in bytes {
        match ESCAPED.iter().position(|&e| e == b) {
            Some(k) => out.extend_from_slice(&[ESC, b'0' + k as u8]),
            None => out.push(b),
        }
    }
    out
}

fn byte_of(c: char) -> Option<u8> {
    let c = c as u32;
    if c < 0x80 || (0xa0..0x100).contains(&c) {
        return Some(c as u8);
    }
    CP1252_HIGH.iter().position(|&h| h as u32 == c).map(|i| 0x80 + i as u8)
}

/// Decodes an element's text back to the bytes given to `encode`.
pub fn decode_text(text: &str) -> Result<Vec<u8>, &'static str> {
    const DAMAGED: &str = "Embedded data is damaged";
    let mut out = Vec::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        let b = byte_of(c).ok_or(DAMAGED)?;
        if b != ESC {
            out.push(b);
            continue;
        }
        let k = chars.next().and_then(byte_of).and_then(|k| k.checked_sub(b'0')).ok_or(DAMAGED)?;
        out.push(*ESCAPED.get(k as usize).ok_or(DAMAGED)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::random_bytes;

    // What the browser's windows-1252 decoder makes of the page's bytes.
    fn as_browser_reads(bytes: &[u8]) -> String {
        bytes.iter().map(|&b| if (0x80..0xa0).contains(&b) { char::from_u32(CP1252_HIGH[b as usize - 0x80] as u32).unwrap() } else { b as char }).collect()
    }

    #[test]
    fn round_trips_through_the_browsers_decoding() {
        let mut samples: Vec<Vec<u8>> = vec![vec![], (0..=255).collect(), vec![0, 13, 60, 0x7f], vec![60; 1000], b"void setup() {}\nvoid loop() {}\n".repeat(500), random_bytes(100_000, 1)];
        samples.extend((0..300).map(|n| random_bytes(n, n as u64 + 2)));
        for bytes in samples {
            let encoded = encode(&bytes);
            assert!(!encoded.iter().any(|b| [0, b'\r', b'<'].contains(b)), "no NUL, CR or <");
            assert_eq!(decode_text(&as_browser_reads(&encoded)).unwrap(), bytes);
        }
    }

    #[test]
    fn costs_little_on_compressed_data() {
        let data = random_bytes(1 << 20, 7);
        let overhead = encode(&data).len() as f64 / data.len() as f64 - 1.0;
        assert!(overhead < 0.02, "{overhead}");
    }

    #[test]
    fn rejects_damaged_text() {
        assert!(decode_text("abc\u{7f}").is_err());
        assert!(decode_text("abc\u{7f}9").is_err());
        assert!(decode_text("€ ok, but ☃ isn't windows-1252").is_err());
    }
}
