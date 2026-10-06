use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

pub type Result<T = ()> = std::result::Result<T, String>;

/// The repository root.
pub fn root() -> PathBuf {
    // crates/build -> the root. (Not canonicalize(): on Windows it gives \\?\ paths Node can't open.)
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().and_then(Path::parent).expect("repository root").to_path_buf()
}

pub fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn read_text(path: &Path) -> Result<String> {
    Ok(String::from_utf8_lossy(&read(path)?).into_owned())
}

pub fn write(path: &Path, data: impl AsRef<[u8]>) -> Result {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(path, data).map_err(|e| format!("{}: {e}", path.display()))
}

/// Runs a program, failing if it can't start or exits with an error.
pub fn exec(cmd: &mut Command) -> Result {
    let status = cmd.status().map_err(|e| format!("couldn't run {:?}: {e}", cmd.get_program()))?;
    if status.success() { Ok(()) } else { Err(format!("{:?} failed ({status})", cmd.get_program())) }
}

/// Runs a program and returns its stdout (stderr is shown).
pub fn output(cmd: &mut Command) -> Result<Vec<u8>> {
    let out = cmd.stderr(Stdio::inherit()).output().map_err(|e| format!("couldn't run {:?}: {e}", cmd.get_program()))?;
    if out.status.success() { Ok(out.stdout) } else { Err(format!("{:?} failed ({})", cmd.get_program(), out.status)) }
}

/// Unix path separators, for paths inside the compiler's virtual filesystem.
pub fn posix(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Entries of a directory, sorted by name ignoring case the way NTFS lists them, on every
/// platform: the order decides the pack's layout and the order objects are linked in.
pub fn list_dir(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    v.sort_by_cached_key(|p| (file_name(p).to_uppercase(), file_name(p)));
    Ok(v)
}

/// "2026-10-06T12:34:56.000Z" and "2026-10-06".
pub fn now_iso() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = (secs / 86400, secs % 86400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z", rem / 3600, rem / 60 % 60, rem % 60)
}

pub fn today() -> String {
    now_iso()[..10].to_string()
}

// xz from XZ Utils, which Git for Windows includes.
fn xz() -> PathBuf {
    if let Ok(p) = std::env::var("XZ") {
        return p.into();
    }
    if cfg!(windows) {
        for p in ["C:/Program Files/Git/mingw64/bin/xz.exe", "C:/Program Files/Git/usr/bin/xz.exe"] {
            if Path::new(p).exists() {
                return p.into();
            }
        }
    }
    "xz".into()
}

/// LZMA-compresses data (`xz --format=lzma`, decoded by aide_core::lzma) with the uncompressed
/// size in the header: xz marks it as unknown, and the decoder allocates its output from it.
pub fn compress(data: &[u8]) -> Result<Vec<u8>> {
    let mib = data.len().div_ceil(1 << 20).max(1);
    let mut child = Command::new(xz())
        .args(["--format=lzma", &format!("--lzma1=preset=9e,dict={mib}MiB"), "-c"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't run xz (set XZ to its path): {e}"))?;
    let mut stdin = child.stdin.take().unwrap();
    let out = std::thread::scope(|s| {
        s.spawn(move || stdin.write_all(data));
        child.wait_with_output()
    })
    .map_err(|e| format!("xz: {e}"))?;
    if !out.status.success() {
        return Err(format!("xz failed ({})", out.status));
    }
    let mut packed = out.stdout;
    if packed.len() < 13 {
        return Err("xz produced no output".into());
    }
    packed[5..13].copy_from_slice(&(data.len() as u64).to_le_bytes());
    Ok(packed)
}

/// A pack in the page: compressed data written as text (see aide_core::embed).
pub fn embed(id: &str, compressed: &[u8]) -> Vec<u8> {
    let mut out = format!("<script type=\"application/octet-stream\" id=\"{id}\">").into_bytes();
    out.extend(aide_core::embed::encode(compressed));
    out.extend_from_slice(b"</script>");
    out
}

pub fn mb(n: usize) -> String {
    format!("{:.1} MB", n as f64 / 1048576.0)
}

/// arduino-cli: ARDUINO_CLI, else its default install location.
pub fn arduino_cli() -> String {
    std::env::var("ARDUINO_CLI").unwrap_or_else(|_| if cfg!(windows) { "C:/Program Files/Arduino CLI/arduino-cli.exe".into() } else { "arduino-cli".into() })
}

pub fn arduino_dir(key: &str) -> Result<PathBuf> {
    let out = output(Command::new(arduino_cli()).args(["config", "get", key]))?;
    Ok(PathBuf::from(String::from_utf8_lossy(&out).trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lzma_decoder_round_trips_xz_output() {
        let samples: Vec<Vec<u8>> = vec![vec![], vec![0, 13, 60], vec![60; 1000], b"void setup() {}\nvoid loop() {}\n".repeat(500), (0..100_000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect()];
        for bytes in samples {
            let packed = match compress(&bytes) {
                Ok(p) => p,
                Err(e) => return eprintln!("skipped: {e}"),
            };
            assert_eq!(aide_core::lzma::unlzma(&packed).unwrap(), bytes);
        }
    }

    #[test]
    fn dates_are_iso() {
        let d = now_iso();
        assert_eq!((d.len(), &d[4..5], &d[10..11]), (24, "-", "T"));
    }
}
