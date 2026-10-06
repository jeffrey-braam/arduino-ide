//! Serial Monitor text: turns chunks received from the board into text to show (optionally
//! timestamped) and complete lines for the Serial Plotter.

#[derive(Default)]
pub struct MonitorStream {
    at_line_start: bool,
    partial_line: String,
}

// A line this long with no newline in sight isn't line data.
const MAX_PARTIAL_LINE: usize = 4096;

impl MonitorStream {
    pub fn new() -> Self {
        MonitorStream { at_line_start: true, partial_line: String::new() }
    }

    /// Adds a received chunk. Returns the text to show and the lines it completed. `stamp` is
    /// put at the start of every shown line when `timestamps` is on.
    pub fn push(&mut self, chunk: &str, timestamps: bool, stamp: &str) -> (String, Vec<String>) {
        let chunk = chunk.replace('\r', ""); // println sends \r\n; the \r would show as a stray space

        self.partial_line.push_str(&chunk);
        let mut lines: Vec<String> = self.partial_line.split('\n').map(String::from).collect();
        self.partial_line = lines.pop().unwrap_or_default();
        if self.partial_line.len() > MAX_PARTIAL_LINE {
            self.partial_line.clear();
        }

        let shown = if timestamps {
            let mut out = String::with_capacity(chunk.len());
            for ch in chunk.chars() {
                if self.at_line_start {
                    out.push_str(stamp);
                }
                out.push(ch);
                self.at_line_start = ch == '\n';
            }
            out
        } else {
            if !chunk.is_empty() {
                self.at_line_start = chunk.ends_with('\n');
            }
            chunk
        };
        (shown, lines)
    }

    /// Forgets a partly received line (the port was reopened).
    pub fn reset_lines(&mut self) {
        self.partial_line.clear();
    }

    /// The shown text was cleared.
    pub fn clear(&mut self) {
        self.at_line_start = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_lines_across_chunks() {
        let mut m = MonitorStream::new();
        assert_eq!(m.push("12\r\n3", false, ""), ("12\n3".into(), vec!["12".into()]));
        assert_eq!(m.push("4\r\n5\r\n", false, ""), ("4\n5\n".into(), vec!["34".into(), "5".into()]));
    }

    #[test]
    fn timestamps_each_shown_line() {
        let mut m = MonitorStream::new();
        assert_eq!(m.push("a\nb", true, "T> ").0, "T> a\nT> b");
        assert_eq!(m.push("c\n", true, "U> ").0, "c\n");
        assert_eq!(m.push("d", true, "V> ").0, "V> d");
        m.clear();
        assert_eq!(m.push("e", true, "W> ").0, "W> e");
    }

    #[test]
    fn drops_endless_lines() {
        let mut m = MonitorStream::new();
        m.push(&"x".repeat(5000), false, "");
        assert_eq!(m.push("\n", false, "").1, vec![String::new()]);
    }
}
