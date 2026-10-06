//! Serial Plotter input, in the same format as the Arduino IDE's plotter:
//!   Serial.println(value);                               -> one line
//!   Serial.print(a); Serial.print(" "); Serial.println(b); -> two lines ("value 1", "value 2")
//!   Serial.print("light:"); Serial.print(l); Serial.print(","); ... -> named lines
//! Values can be separated by spaces, tabs or commas. Lines without numbers are ignored.

#[derive(Debug, Clone, PartialEq)]
pub struct PlotValue {
    pub label: String,
    pub value: f64,
}

// [-+]? (digits [.] digits* | . digits) ([eE] [-+]? digits)?
fn parse_number(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let digits = |mut i: usize| {
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        (i, i - start)
    };
    let mut i = if matches!(b.first(), Some(b'+' | b'-')) { 1 } else { 0 };
    let (j, n) = digits(i);
    i = j;
    if n > 0 {
        if b.get(i) == Some(&b'.') {
            i = digits(i + 1).0;
        }
    } else {
        if b.get(i) != Some(&b'.') {
            return None;
        }
        let (j, n) = digits(i + 1);
        if n == 0 {
            return None;
        }
        i = j;
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        let k = if matches!(b.get(i + 1), Some(b'+' | b'-')) { i + 2 } else { i + 1 };
        let (j, n) = digits(k);
        if n == 0 {
            return None;
        }
        i = j;
    }
    if i != b.len() {
        return None;
    }
    s.parse().ok()
}

/// The values in one line of serial output; empty if it holds no data.
pub fn parse_plot_line(line: &str) -> Vec<PlotValue> {
    let mut out = Vec::new();
    let mut unnamed = 0;
    for token in line.split(|c: char| c.is_whitespace() || c == ',').filter(|t| !t.is_empty()) {
        match token.rfind(':') {
            Some(colon) if colon > 0 => {
                if let Some(value) = parse_number(&token[colon + 1..]) {
                    out.push(PlotValue { label: token[..colon].to_string(), value });
                }
            }
            _ => {
                if let Some(value) = parse_number(token) {
                    unnamed += 1;
                    out.push(PlotValue { label: format!("value {unnamed}"), value });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(line: &str) -> Vec<(String, f64)> {
        parse_plot_line(line).into_iter().map(|v| (v.label, v.value)).collect()
    }
    fn v(pairs: &[(&str, f64)]) -> Vec<(String, f64)> {
        pairs.iter().map(|(l, v)| (l.to_string(), *v)).collect()
    }

    #[test]
    fn a_single_number() {
        assert_eq!(p("512"), v(&[("value 1", 512.0)]));
    }

    #[test]
    fn several_numbers_separated_by_spaces_tabs_or_commas() {
        assert_eq!(p("1 2.5\t-3,4e2"), v(&[("value 1", 1.0), ("value 2", 2.5), ("value 3", -3.0), ("value 4", 400.0)]));
    }

    #[test]
    fn label_value_pairs() {
        assert_eq!(p("light:300,temp:21.5"), v(&[("light", 300.0), ("temp", 21.5)]));
    }

    #[test]
    fn text_lines_are_ignored() {
        assert_eq!(p("SerialEcho ready"), v(&[]));
        assert_eq!(p(""), v(&[]));
        assert_eq!(p("label:abc"), v(&[]));
        assert_eq!(p(":5 e5 1e .5. --1"), v(&[]));
    }

    #[test]
    fn number_forms() {
        assert_eq!(p("+1 .5 5. 5.e1 1E-1"), v(&[("value 1", 1.0), ("value 2", 0.5), ("value 3", 5.0), ("value 4", 50.0), ("value 5", 0.1)]));
    }
}
