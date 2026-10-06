//! Reads section sizes from a 32-bit little-endian ELF file (what avr-ld produces) to report
//! flash and RAM use like the Arduino IDE: flash = .text + .data, RAM = .data + .bss + .noinit.

use std::collections::HashMap;

fn u16_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u16::from_le_bytes(b.get(o..o + 2)?.try_into().ok()?) as u32)
}

fn u32_at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

pub fn section_sizes(bytes: &[u8]) -> Result<HashMap<String, u32>, String> {
    let bad = || "not an ELF file".to_string();
    if bytes.get(..4) != Some(b"\x7fELF") {
        return Err(bad());
    }
    let shoff = u32_at(bytes, 0x20).ok_or_else(bad)? as usize;
    let shentsize = u16_at(bytes, 0x2e).ok_or_else(bad)? as usize;
    let shnum = u16_at(bytes, 0x30).ok_or_else(bad)? as usize;
    let shstrndx = u16_at(bytes, 0x32).ok_or_else(bad)? as usize;
    // (name offset, file offset, size)
    let sec = |i: usize| -> Option<(usize, usize, u32)> {
        let o = shoff + i * shentsize;
        Some((u32_at(bytes, o)? as usize, u32_at(bytes, o + 16)? as usize, u32_at(bytes, o + 20)?))
    };
    let (_, strtab, _) = sec(shstrndx).ok_or_else(bad)?;
    let name_at = |off: usize| -> String {
        let start = (strtab + off).min(bytes.len());
        let len = bytes[start..].iter().position(|&b| b == 0).unwrap_or(bytes.len() - start);
        String::from_utf8_lossy(&bytes[start..start + len]).into_owned()
    };
    let mut sizes = HashMap::new();
    for i in 0..shnum {
        let (name, _, size) = sec(i).ok_or_else(bad)?;
        sizes.insert(name_at(name), size);
    }
    Ok(sizes)
}

pub struct MemoryUsage {
    pub flash: u32,
    pub ram: u32,
}

pub fn memory_usage(elf: &[u8]) -> Result<MemoryUsage, String> {
    let s = section_sizes(elf)?;
    let g = |n: &str| s.get(n).copied().unwrap_or(0);
    Ok(MemoryUsage { flash: g(".text") + g(".data"), ram: g(".data") + g(".bss") + g(".noinit") })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A minimal ELF: null section, .text (100), .data (6), .bss (20), .shstrtab.
    fn tiny_elf() -> Vec<u8> {
        let names = b"\0.text\0.data\0.bss\0.shstrtab\0";
        let strtab_off = 52usize;
        let shoff = strtab_off + names.len();
        let mut b = vec![0u8; shoff + 5 * 40];
        b[..4].copy_from_slice(b"\x7fELF");
        b[0x20..0x24].copy_from_slice(&(shoff as u32).to_le_bytes());
        b[0x2e..0x30].copy_from_slice(&40u16.to_le_bytes());
        b[0x30..0x32].copy_from_slice(&5u16.to_le_bytes());
        b[0x32..0x34].copy_from_slice(&4u16.to_le_bytes());
        b[strtab_off..shoff].copy_from_slice(names);
        for (i, (name, off, size)) in [(0u32, 0u32, 0u32), (1, 0, 100), (7, 0, 6), (13, 0, 20), (18, strtab_off as u32, names.len() as u32)].into_iter().enumerate() {
            let o = shoff + i * 40;
            b[o..o + 4].copy_from_slice(&name.to_le_bytes());
            b[o + 16..o + 20].copy_from_slice(&off.to_le_bytes());
            b[o + 20..o + 24].copy_from_slice(&size.to_le_bytes());
        }
        b
    }

    #[test]
    fn reports_flash_and_ram_like_the_arduino_ide() {
        let m = memory_usage(&tiny_elf()).unwrap();
        assert_eq!((m.flash, m.ram), (106, 26));
    }

    #[test]
    fn rejects_other_files() {
        assert!(memory_usage(b"MZ not elf").is_err());
        assert!(memory_usage(&tiny_elf()[..60]).is_err());
    }
}
