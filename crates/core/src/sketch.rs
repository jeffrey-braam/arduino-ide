//! Rules for the files of a sketch (its tabs).

use crate::collate;
use regex_lite::Regex;
use std::sync::OnceLock;

/// Checks a new tab name, adding .ino when there's no extension. `existing` are the current tabs.
pub fn validate_tab_name(input: &str, existing: &[String]) -> Result<String, String> {
    let mut name = input.trim().to_string();
    if name.is_empty() {
        return Err("Please enter a name.".into());
    }
    if !name.rfind('.').is_some_and(|i| i + 1 < name.len()) {
        name.push_str(".ino");
    }
    let mut chars = name.chars();
    let ok_char = |c: char| c.is_ascii_alphanumeric() || c == '_';
    if !chars.next().is_some_and(ok_char) || !chars.all(|c| ok_char(c) || c == '.' || c == '-') {
        return Err("Use only letters, numbers, _ . and -, starting with a letter, number or _.".into());
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !["ino", "h", "hpp", "cpp"].contains(&ext.as_str()) {
        return Err("Tabs can be .ino, .h, .hpp or .cpp files.".into());
    }
    if existing.iter().any(|f| f.to_lowercase() == name.to_lowercase()) {
        return Err(format!("There's already a tab called “{name}”."));
    }
    Ok(name)
}

fn is_sketch_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".ino") || lower.ends_with(".pde")
}

/// Tab order for opened files, as indexes into `files` (name, code): the .ino that defines
/// setup() first (else the first .ino), then the rest by name.
pub fn order_opened_files(files: &[(String, String)]) -> Vec<usize> {
    static SETUP: OnceLock<Regex> = OnceLock::new();
    let setup = SETUP.get_or_init(|| Regex::new(r"\bvoid\s+setup\s*\(").unwrap());
    let by_name = |a: &usize, b: &usize| collate::compare(&files[*a].0, &files[*b].0);
    let mut inos: Vec<usize> = (0..files.len()).filter(|&i| is_sketch_file(&files[i].0)).collect();
    inos.sort_by(by_name);
    let Some(main) = inos.iter().copied().find(|&i| setup.is_match(&files[i].1)).or(inos.first().copied()).or(if files.is_empty() { None } else { Some(0) }) else {
        return vec![];
    };
    let mut rest: Vec<usize> = (0..files.len()).filter(|&i| i != main).collect();
    rest.sort_by(by_name);
    std::iter::once(main).chain(rest).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn validates_tab_names() {
        let tabs = names(&["sketch.ino", "Config.h"]);
        assert_eq!(validate_tab_name(" leds ", &tabs), Ok("leds.ino".into()));
        assert_eq!(validate_tab_name("pins.h", &tabs), Ok("pins.h".into()));
        assert_eq!(validate_tab_name("Main.CPP", &tabs), Ok("Main.CPP".into()));
        assert_eq!(validate_tab_name("  ", &tabs), Err("Please enter a name.".into()));
        assert!(validate_tab_name("my file", &tabs).unwrap_err().starts_with("Use only"));
        assert!(validate_tab_name(".hidden.h", &tabs).unwrap_err().starts_with("Use only"));
        assert!(validate_tab_name("notes.txt", &tabs).unwrap_err().starts_with("Tabs can be"));
        assert_eq!(validate_tab_name("config.H", &tabs), Err("There's already a tab called “config.H”.".into()));
        assert_eq!(validate_tab_name("x.", &tabs), Ok("x..ino".into()));
    }

    #[test]
    fn puts_the_file_with_setup_first() {
        let files: Vec<(String, String)> = [("b.h", ""), ("helpers.ino", "void helper() {}"), ("Main.ino", "void setup() {}\nvoid loop() {}"), ("a.cpp", "")]
            .iter()
            .map(|(n, c)| (n.to_string(), c.to_string()))
            .collect();
        assert_eq!(order_opened_files(&files), [2, 3, 0, 1]);
        assert_eq!(order_opened_files(&files[..2]), [1, 0]);
        assert_eq!(order_opened_files(&files[..1]), [0]);
        assert!(order_opened_files(&[]).is_empty());
    }
}
