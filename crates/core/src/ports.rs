//! Names for USB serial devices, from their vendor and product IDs.

fn vendor(vid: u16) -> Option<&'static str> {
    Some(match vid {
        0x2341 | 0x2a03 => "Arduino",
        0x1a86 => "CH340 USB serial",
        0x0403 => "FTDI USB serial",
        0x10c4 => "CP210x USB serial",
        0x067b => "PL2303 USB serial",
        _ => return None,
    })
}

fn product(vid: u16, pid: u16) -> Option<&'static str> {
    match (vid, pid) {
        (0x2341, 0x0043 | 0x0001 | 0x0243) | (0x2a03, 0x0043) => Some("Arduino Uno"),
        _ => None,
    }
}

/// "Arduino Uno (2341:0043)"; "Serial port" when the port isn't a USB device.
pub fn describe_port(vid: Option<u16>, pid: Option<u16>) -> String {
    let Some(vid) = vid else { return "Serial port".into() };
    let pid = pid.unwrap_or(0);
    let name = product(vid, pid).or_else(|| vendor(vid)).unwrap_or("USB serial device");
    format!("{name} ({vid:04x}:{pid:04x})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_known_boards_and_chips() {
        assert_eq!(describe_port(Some(0x2341), Some(0x43)), "Arduino Uno (2341:0043)");
        assert_eq!(describe_port(Some(0x1a86), Some(0x7523)), "CH340 USB serial (1a86:7523)");
        assert_eq!(describe_port(Some(0x1234), None), "USB serial device (1234:0000)");
        assert_eq!(describe_port(None, None), "Serial port");
    }
}
