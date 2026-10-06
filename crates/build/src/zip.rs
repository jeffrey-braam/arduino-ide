//! Minimal ZIP files: reading a GitHub source archive (stored + deflate entries), and writing the
//! student download, dist/arduino-ide.zip. Students get the zip rather than the bare .html because
//! previewing the .html (e.g. in Google Drive or Classroom) lays out millions of characters of
//! embedded data as text and freezes the tab; a zip previews as a file list, and ChromeOS's Files
//! app opens it directly.

use crate::util::{now_iso, Result};

pub fn read(buf: &[u8]) -> Result<Vec<(String, Vec<u8>)>> {
    let u16_at = |o: usize| -> Result<usize> { buf.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize).ok_or("bad zip file".into()) };
    let u32_at = |o: usize| -> Result<usize> { buf.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).ok_or("bad zip file".into()) };
    let eocd = (0..=buf.len().saturating_sub(22)).rev().find(|&i| u32_at(i).ok() == Some(0x0605_4b50)).ok_or("not a zip file")?;
    let count = u16_at(eocd + 10)?;
    let mut p = u32_at(eocd + 16)?;
    let mut files = Vec::new();
    for _ in 0..count {
        if u32_at(p)? != 0x0201_4b50 {
            return Err("bad zip central directory".into());
        }
        let method = u16_at(p + 10)?;
        let csize = u32_at(p + 20)?;
        let (name_len, extra_len, comment_len) = (u16_at(p + 28)?, u16_at(p + 30)?, u16_at(p + 32)?);
        let local = u32_at(p + 42)?;
        let name = String::from_utf8_lossy(buf.get(p + 46..p + 46 + name_len).ok_or("bad zip file")?).into_owned();
        let start = local + 30 + u16_at(local + 26)? + u16_at(local + 28)?;
        let data = buf.get(start..start + csize).ok_or("truncated zip file")?;
        if !name.ends_with('/') {
            let data = if method == 8 { miniz_oxide::inflate::decompress_to_vec(data).map_err(|e| format!("{name}: {e:?}"))? } else { data.to_vec() };
            files.push((name, data));
        }
        p += 46 + name_len + extra_len + comment_len;
    }
    Ok(files)
}

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, t) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *t = c;
    }
    !data.iter().fold(!0u32, |c, &b| table[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8))
}

// The current time as MS-DOS (time, date), which is what ZIP stores. ZIP means local time, but
// this is UTC: the standard library can't tell the time zone, and it's only shown in file lists.
fn dos_now() -> (u16, u16) {
    let t = now_iso(); // 2026-10-06T12:34:56.000Z
    let n = |r: std::ops::Range<usize>| t[r].parse::<u16>().unwrap_or(0);
    let time = (n(11..13) << 11) | (n(14..16) << 5) | (n(17..19) / 2);
    let date = (n(0..4).saturating_sub(1980) << 9) | (n(5..7) << 5) | n(8..10);
    (time, date)
}

/// A zip holding `files` (name, contents), each deflated unless that doesn't make it smaller.
pub fn write(files: &[(&str, &[u8])]) -> Vec<u8> {
    let (time, date) = dos_now();
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let deflated = miniz_oxide::deflate::compress_to_vec(data, 9);
        let (method, stored): (u16, &[u8]) = if deflated.len() < data.len() { (8, &deflated) } else { (0, data) };
        let crc = crc32(data);
        let offset = out.len() as u32;
        // Fields shared by the local header and the central directory entry, from "version needed".
        let mut common = Vec::new();
        common.extend_from_slice(&20u16.to_le_bytes()); // version needed: 2.0
        common.extend_from_slice(&0x0800u16.to_le_bytes()); // flags: UTF-8 names
        common.extend_from_slice(&method.to_le_bytes());
        common.extend_from_slice(&time.to_le_bytes());
        common.extend_from_slice(&date.to_le_bytes());
        common.extend_from_slice(&crc.to_le_bytes());
        common.extend_from_slice(&(stored.len() as u32).to_le_bytes());
        common.extend_from_slice(&(data.len() as u32).to_le_bytes());
        common.extend_from_slice(&(name.len() as u16).to_le_bytes());
        common.extend_from_slice(&0u16.to_le_bytes()); // extra field length

        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&common);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(stored);

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&common);
        central.extend_from_slice(&[0; 6]); // comment length, disk number, internal attributes
        central.extend_from_slice(&0u32.to_le_bytes()); // external attributes
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
    }
    let central_offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0; 4]); // disk numbers
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&central_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment length
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn round_trips_deflated_and_stored_entries() {
        let text = b"void setup() {}\nvoid loop() {}\n".repeat(200);
        let noise: Vec<u8> = (0..5000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
        let zip = write(&[("a.html", &text), ("b.bin", &noise), ("empty", b"")]);
        let files = read(&zip).unwrap();
        assert_eq!(files, vec![("a.html".to_string(), text.clone()), ("b.bin".to_string(), noise), ("empty".to_string(), vec![])]);
        assert!(zip.len() < text.len());
    }
}
