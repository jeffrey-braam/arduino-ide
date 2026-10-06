//! Turns a .ino sketch into C++ the way the Arduino IDE does: adds `#include <Arduino.h>`,
//! declares functions ahead of use (so they can be called before they're defined), and keeps
//! compiler messages pointing at the student's line numbers via #line.
//!
//! Positions are byte offsets. Masking replaces every byte of a hidden character with a space,
//! so masked text has the same offsets as the original.

use regex_lite::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

fn blank(out: &mut [u8], from: usize, to: usize) {
    let to = to.min(out.len());
    for b in &mut out[from..to] {
        if *b != b'\n' {
            *b = b' ';
        }
    }
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    hay.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|i| i + from)
}

/// Replaces comments, and optionally string/char literals, with spaces (newlines kept) so that
/// positions and line numbers still match the original text.
pub fn mask(code: &str, strings: bool) -> String {
    let src = code.as_bytes();
    let mut out = src.to_vec();
    let len = src.len();
    let mut i = 0;
    while i < len {
        let (c, n) = (src[i], src.get(i + 1).copied());
        if c == b'/' && n == Some(b'/') {
            let stop = find(src, b"\n", i).unwrap_or(len);
            blank(&mut out, i, stop);
            i = stop;
        } else if c == b'/' && n == Some(b'*') {
            let stop = find(src, b"*/", i + 2).map_or(len, |e| e + 2);
            blank(&mut out, i, stop);
            i = stop;
        } else if c == b'"' || c == b'\'' {
            let mut j = i + 1;
            while j < len && src[j] != c && src[j] != b'\n' {
                j += if src[j] == b'\\' { 2 } else { 1 };
            }
            let j = j.min(len);
            if strings {
                blank(&mut out, i + 1, j);
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }
    // Only whole characters between ASCII delimiters were replaced, so this is still UTF-8.
    String::from_utf8(out).expect("masking keeps UTF-8 valid")
}

// Blanks preprocessor lines, including backslash-continued ones: they can contain braces or look
// like signatures.
fn blank_directives(text: &mut [u8]) {
    let len = text.len();
    let mut line = 0;
    while line < len {
        let line_end = find(text, b"\n", line).unwrap_or(len);
        let first = (line..line_end).find(|&k| text[k] != b' ' && text[k] != b'\t');
        if first.is_some_and(|k| text[k] == b'#') {
            let mut pos = line;
            loop {
                let seg_end = (pos..len).find(|&k| text[k] == b'\r' || text[k] == b'\n').unwrap_or(len);
                let continued = seg_end > pos && text[seg_end - 1] == b'\\';
                blank(text, pos, seg_end);
                if !continued {
                    break;
                }
                let mut q = seg_end;
                if text.get(q) == Some(&b'\r') {
                    q += 1;
                }
                if text.get(q) != Some(&b'\n') {
                    break;
                }
                blank(text, seg_end, q);
                pos = q + 1;
            }
            line = pos;
        }
        line = find(text, b"\n", line).map_or(len, |e| e + 1);
    }
}

fn line_at(text: &str, index: usize) -> usize {
    1 + text.as_bytes()[..index].iter().filter(|&&b| b == b'\n').count()
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn include_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?m)^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\n]+)[>"]"#).unwrap())
}

// return type, name, (args) — args may contain one level of parentheses, e.g. function pointers
fn signature_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^([A-Za-z_][\w\s\*&:<>,]*?[\s\*&])([A-Za-z_]\w*)\s*\(([^;{}()]*(?:\([^;{}()]*\)[^;{}()]*)*)\)\s*(const\s*)?$").unwrap()
    })
}

fn keyword_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b(class|struct|union|enum|namespace|template|typedef|operator)\b").unwrap())
}

const NOT_FUNCTIONS: [&str; 9] = ["if", "for", "while", "switch", "catch", "return", "sizeof", "do", "else"];

pub fn find_includes(code: &str) -> Vec<String> {
    let masked = mask(code, false);
    include_re().captures_iter(&masked).map(|m| m[1].trim().to_string()).collect()
}

#[derive(Debug, Clone)]
pub struct FunctionDef {
    pub name: String,
    pub signature: String,
    pub line: usize,
    pub args: String,
}

/// Functions defined at file scope, and the names of functions already declared there.
pub fn find_functions(code: &str) -> (Vec<FunctionDef>, HashSet<String>) {
    let mut bytes = mask(code, true).into_bytes();
    blank_directives(&mut bytes);
    let masked = String::from_utf8(bytes).expect("blanking keeps UTF-8 valid");
    let sig_re = signature_re();
    let mut defs = Vec::new();
    let mut declared = HashSet::new();
    let mut depth = 0usize;
    let mut seg_start = 0;
    for (i, c) in masked.bytes().enumerate() {
        match c {
            b'{' => {
                if depth == 0 {
                    let raw = &masked[seg_start..i];
                    let sig = collapse_whitespace(raw);
                    if let Some(m) = sig_re.captures(&sig) {
                        let start = seg_start + raw.find(|c: char| !c.is_whitespace()).unwrap_or(0);
                        let original = &code[start..i];
                        // A signature split by #if/#endif lines (e.g. board-specific attributes)
                        // can't be copied safely into a declaration, so those are left alone.
                        let spans_directive = original.split('\n').any(|l| l.trim_start_matches([' ', '\t']).starts_with('#'));
                        let name = &m[2];
                        if !spans_directive && !NOT_FUNCTIONS.contains(&name) && !keyword_re().is_match(&sig) && !sig.contains('=') && !m[1].contains("::") {
                            defs.push(FunctionDef { name: name.to_string(), signature: collapse_whitespace(original), line: line_at(code, start), args: m[3].to_string() });
                        }
                    }
                }
                depth += 1;
                seg_start = i + 1;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                seg_start = i + 1;
            }
            b';' if depth == 0 => {
                let sig = collapse_whitespace(&masked[seg_start..i]);
                if let Some(m) = sig_re.captures(&sig) {
                    declared.insert(m[2].to_string());
                }
                seg_start = i + 1;
            }
            _ => {}
        }
    }
    (defs, declared)
}

pub struct InoFile<'a> {
    pub name: &'a str,
    pub code: &'a str,
}

pub struct Preprocessed {
    pub cpp: String,
    pub prototypes: Vec<String>,
}

fn json_string(s: &str) -> String {
    serde_json::to_string(s).expect("strings serialize")
}

/// `files`: the main sketch first; other .ino tabs follow, as in the Arduino IDE (which appends
/// the other .ino tabs in alphabetical order).
pub fn preprocess_sketch(files: &[InoFile]) -> Preprocessed {
    // Merge the tabs, remembering where every merged line came from.
    let mut lines: Vec<String> = Vec::new();
    let mut origin: Vec<Option<(&str, usize)>> = Vec::new();
    for f in files {
        let code = f.code.replace("\r\n", "\n").replace('\r', "\n");
        lines.push(format!("#line 1 {}", json_string(f.name)));
        origin.push(None);
        for (i, l) in code.split('\n').enumerate() {
            lines.push(l.to_string());
            origin.push(Some((f.name, i + 1)));
        }
    }
    let merged = lines.join("\n");
    let (defs, declared) = find_functions(&merged);
    let line_directive = |merged_line: usize| match origin.get(merged_line - 1).copied().flatten() {
        Some((file, line)) => format!("#line {line} {}\n", json_string(file)),
        None => String::new(),
    };

    // Functions with default arguments can't be declared twice with defaults; the student must
    // define those before use, as in the Arduino IDE.
    let mut seen = HashSet::new();
    let unique: Vec<&FunctionDef> = defs
        .iter()
        .filter(|d| !declared.contains(&d.name) && !d.args.contains('='))
        .filter(|d| seen.insert(d.signature.clone()))
        .collect();

    let mut out = String::from("#include <Arduino.h>\n");
    if unique.is_empty() {
        out += &merged;
        out.push('\n');
        return Preprocessed { cpp: out, prototypes: vec![] };
    }

    let insert_at = defs[0].line; // before the first function definition
    out += &lines[..insert_at - 1].join("\n");
    out.push('\n');
    for d in &unique {
        out += &line_directive(d.line);
        out += &d.signature;
        out += ";\n";
    }
    out += &line_directive(insert_at);
    out += &lines[insert_at - 1..].join("\n");
    out.push('\n');
    Preprocessed { cpp: out, prototypes: unique.iter().map(|d| format!("{};", d.signature)).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn protos(code: &str) -> Vec<String> {
        preprocess_sketch(&[InoFile { name: "S.ino", code }]).prototypes
    }

    #[test]
    fn declares_functions_defined_after_they_are_used() {
        assert_eq!(protos("void setup() { blink(3); }\nvoid loop() {}\nvoid blink(int n) { }\n"), ["void setup();", "void loop();", "void blink(int n);"]);
    }

    #[test]
    fn skips_functions_the_student_already_declared() {
        assert_eq!(protos("int twice(int x);\nvoid setup() {}\nint twice(int x) { return 2 * x; }\n"), ["void setup();"]);
    }

    #[test]
    fn skips_default_arguments_class_methods_isrs_and_templates() {
        let code = ["void a(int x = 1) {}", "struct P { void m() {} };", "void P2::m() {}", "ISR(TIMER1_COMPA_vect) {}", "template <typename T> T id(T v) { return v; }", "if (x) {}"].join("\n");
        assert!(protos(&code).is_empty());
    }

    #[test]
    fn ignores_braces_and_signatures_inside_comments_and_strings() {
        let code = "// void fake() {\n/* int nope() { */\nconst char *s = \"void str() {\";\nvoid real() {}\n";
        assert_eq!(protos(code), ["void real();"]);
    }

    #[test]
    fn leaves_signatures_split_by_if_lines_alone() {
        let code = "#if defined(ESP32)\nIRAM_ATTR\n#endif\nvoid handler() {}\nvoid setup() {}\n";
        assert_eq!(protos(code), ["void setup();"]);
    }

    #[test]
    fn ignores_continued_macros() {
        let code = "#define TWICE(x) \\\n  void bad() { x; }\nvoid setup() {}\n";
        assert_eq!(protos(code), ["void setup();"]);
    }

    #[test]
    fn keeps_the_students_line_numbers_with_line_directives() {
        let cpp = preprocess_sketch(&[InoFile { name: "S.ino", code: "int x;\nvoid setup() {}\nvoid loop() {}\n" }]).cpp;
        let lines: Vec<&str> = cpp.split('\n').collect();
        assert_eq!(lines[0], "#include <Arduino.h>");
        // After the prototypes, a #line directive puts `void setup() {}` back on line 2.
        let i = lines.iter().position(|l| *l == "void setup() {}").unwrap();
        assert_eq!(lines[i - 1], "#line 2 \"S.ino\"");
    }

    #[test]
    fn merges_extra_ino_tabs_with_their_own_file_names() {
        let r = preprocess_sketch(&[
            InoFile { name: "Main.ino", code: "void setup() { helper(); }\nvoid loop() {}\n" },
            InoFile { name: "helpers.ino", code: "void helper() {}\n" },
        ]);
        assert!(r.prototypes.contains(&"void helper();".to_string()));
        assert!(r.cpp.contains("#line 1 \"helpers.ino\"\nvoid helper();"));
    }

    #[test]
    fn handles_non_ascii_text() {
        let code = "// Grüße 🌡️ {\nconst char *s = \"°C {\";\nvoid zeige() {}\n";
        assert_eq!(protos(code), ["void zeige();"]);
    }

    #[test]
    fn finds_includes_but_not_commented_out_ones() {
        assert_eq!(find_includes("#include <Servo.h>\n// #include <Nope.h>\n  #  include \"local.h\"\n"), ["Servo.h", "local.h"]);
    }

    #[test]
    fn mask_keeps_length_and_line_breaks() {
        let code = "a /* x\ny */ \"s{\" // c\nb";
        let m = mask(code, true);
        assert_eq!(m.len(), code.len());
        assert_eq!(m.split('\n').count(), code.split('\n').count());
        assert!(!m.contains('{'));
    }
}
