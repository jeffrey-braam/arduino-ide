//! File name ordering close to the browser's `localeCompare` (Unicode root collation), which the
//! JavaScript version used for tab order: letters ignore case first, punctuation sorts before
//! digits and digits before letters, and lowercase comes before uppercase on a tie.

use std::cmp::Ordering;

// Root collation order of ASCII punctuation and symbols.
const PUNCTUATION: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary(c: char) -> (u8, u32) {
    if let Some(i) = PUNCTUATION.find(c) {
        (0, i as u32)
    } else if c.is_ascii_digit() {
        (1, c as u32)
    } else if c.is_alphabetic() {
        (2, c.to_lowercase().next().unwrap_or(c) as u32)
    } else {
        (3, c as u32)
    }
}

pub fn compare(a: &str, b: &str) -> Ordering {
    a.chars()
        .map(primary)
        .cmp(b.chars().map(primary))
        .then_with(|| a.chars().map(|c| c.is_uppercase()).cmp(b.chars().map(|c| c.is_uppercase())))
        .then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_like_locale_compare() {
        let mut names = vec!["b.ino", "Zeta.h", "a.ino", "A.ino", "_x.ino", "10.ino", "2.ino", "leds.ino"];
        names.sort_by(|a, b| compare(a, b));
        assert_eq!(names, ["_x.ino", "10.ino", "2.ino", "a.ino", "A.ino", "b.ino", "leds.ino", "Zeta.h"]);
    }
}
