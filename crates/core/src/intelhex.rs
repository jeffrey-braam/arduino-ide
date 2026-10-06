//! Parses Intel HEX text into a flat flash image (gaps filled with 0xFF, erased flash).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HexError(pub String);

impl fmt::Display for HexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for HexError {}

pub fn parse_intel_hex(text: &str) -> Result<Vec<u8>, HexError> {
    let err = |m: String| Err(HexError(m));
    let mut chunks: Vec<(usize, Vec<u8>)> = Vec::new();
    let mut base = 0usize;
    let mut end = 0usize;
    let mut saw_eof = false;

    for (n, line) in text.split('\n').enumerate() {
        if saw_eof {
            break;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let at = format!("Line {}", n + 1);
        let Some(body) = line.strip_prefix(':') else {
            return err(format!("{at}: expected a line starting with ':'"));
        };
        if body.is_empty() || body.len() % 2 != 0 || !body.bytes().all(|b| b.is_ascii_hexdigit()) {
            return err(format!("{at}: not valid hex digits"));
        }
        let bytes: Vec<u8> = (0..body.len() / 2).map(|i| u8::from_str_radix(&body[i * 2..i * 2 + 2], 16).unwrap()).collect();
        if bytes.len() < 5 || bytes.len() != bytes[0] as usize + 5 {
            return err(format!("{at}: wrong record length"));
        }
        if bytes.iter().fold(0u8, |a, &b| a.wrapping_add(b)) != 0 {
            return err(format!("{at}: checksum mismatch"));
        }

        let len = bytes[0] as usize;
        let addr = ((bytes[1] as usize) << 8) | bytes[2] as usize;
        let data = &bytes[4..4 + len];
        let word = || if len >= 2 { ((data[0] as usize) << 8) | data[1] as usize } else { 0 };
        match bytes[3] {
            0x00 => {
                end = end.max(base + addr + len);
                chunks.push((base + addr, data.to_vec()));
            }
            0x01 => saw_eof = true,
            0x02 => base = word() * 16,
            0x04 => base = word() * 65536,
            0x03 | 0x05 => {} // start addresses; irrelevant for flashing
            t => return err(format!("{at}: unknown record type {t}")),
        }
    }
    if !saw_eof {
        return err("File is incomplete (no end-of-file record)".into());
    }
    if chunks.is_empty() {
        return err("File contains no program data".into());
    }
    if end > 16 * 1024 * 1024 {
        return err("Program is far too large for this board".into());
    }

    let mut image = vec![0xffu8; end];
    for (addr, data) in &chunks {
        image[*addr..*addr + data.len()].copy_from_slice(data);
    }
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLINK: &str = include_str!("../../../test/fixtures/Blink.ino.hex");
    const SERIAL_ECHO: &str = include_str!("../../../test/fixtures/SerialEcho.ino.hex");

    #[test]
    fn parses_arduino_cli_blink_output_to_the_reported_sketch_size() {
        let image = parse_intel_hex(BLINK).unwrap();
        assert_eq!(image.len(), 922); // arduino-cli: "Sketch uses 922 bytes"
        assert_eq!(&image[..2], &[0x0c, 0x94]); // reset vector is a JMP (0x940C, little-endian)
    }

    #[test]
    fn parses_serial_echo_output_to_the_reported_sketch_size() {
        assert_eq!(parse_intel_hex(SERIAL_ECHO).unwrap().len(), 3344);
    }

    #[test]
    fn fills_gaps_with_ff_and_honours_extended_linear_addresses() {
        let image = parse_intel_hex(":020000040000FA\n:02000400ABCD82\n:00000001FF").unwrap();
        assert_eq!(image, [0xff, 0xff, 0xff, 0xff, 0xab, 0xcd]);
    }

    #[test]
    fn rejects_a_bad_checksum() {
        assert!(parse_intel_hex(":02000400ABCD83\n:00000001FF").unwrap_err().0.contains("checksum"));
    }

    #[test]
    fn rejects_a_file_without_an_end_record() {
        assert!(parse_intel_hex(":02000400ABCD82").unwrap_err().0.contains("incomplete"));
    }

    #[test]
    fn rejects_non_hex_content() {
        assert!(parse_intel_hex("void setup() {}").is_err());
    }
}
