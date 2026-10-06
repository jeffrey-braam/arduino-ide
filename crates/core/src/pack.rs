//! A minimal archive format for the compiler's files:
//!   "AIDEPAK1" | u32 LE header length | header JSON { manifest, files: [[path, offset, size], ...] } | data

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::ops::Range;

const MAGIC: &[u8] = b"AIDEPAK1";

#[derive(Serialize)]
struct HeaderOut<'a, M: Serialize> {
    manifest: &'a M,
    files: Vec<(&'a str, usize, usize)>,
}

#[derive(Deserialize)]
struct HeaderIn<'a> {
    #[serde(borrow)]
    manifest: &'a RawValue,
    files: Vec<(String, usize, usize)>,
}

pub fn write_pack<M: Serialize>(files: &[(String, Vec<u8>)], manifest: &M) -> Vec<u8> {
    let mut entries = Vec::with_capacity(files.len());
    let mut offset = 0;
    for (p, data) in files {
        entries.push((p.as_str(), offset, data.len()));
        offset += data.len();
    }
    let header = serde_json::to_vec(&HeaderOut { manifest, files: entries }).expect("manifest serializes");
    let mut out = Vec::with_capacity(MAGIC.len() + 4 + header.len() + offset);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(header.len() as u32).to_le_bytes());
    out.extend_from_slice(&header);
    for (_, data) in files {
        out.extend_from_slice(data);
    }
    out
}

/// An unpacked archive. File contents stay in `data`; `files` holds their ranges, in pack order.
pub struct Pack {
    pub data: Vec<u8>,
    pub manifest_json: String,
    pub files: Vec<(String, Range<usize>)>,
}

impl Pack {
    pub fn read(data: Vec<u8>) -> Result<Pack, String> {
        let damaged = |why: &str| format!("Compiler data is damaged ({why})");
        if data.get(..MAGIC.len()) != Some(MAGIC) {
            return Err(damaged("bad header"));
        }
        let start = MAGIC.len() + 4;
        let len_bytes = data.get(MAGIC.len()..start).ok_or_else(|| damaged("bad header"))?;
        let header_len = u32::from_le_bytes(len_bytes.try_into().unwrap()) as usize;
        let header = data.get(start..start + header_len).ok_or_else(|| damaged("truncated"))?;
        let h: HeaderIn = serde_json::from_slice(header).map_err(|e| damaged(&e.to_string()))?;
        let base = start + header_len;
        let mut files = Vec::with_capacity(h.files.len());
        for (p, offset, size) in h.files {
            let r = base + offset..base + offset + size;
            if r.end > data.len() {
                return Err(damaged("truncated"));
            }
            files.push((p, r));
        }
        let manifest_json = h.manifest.get().to_string();
        Ok(Pack { data, manifest_json, files })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let files = vec![("/a.h".to_string(), b"int a;".to_vec()), ("/tools/x.wasm".to_string(), vec![0, 1, 2]), ("/empty".to_string(), vec![])];
        let manifest = serde_json::json!({ "libraries": [], "gcc": "7.3.0" });
        let pack = Pack::read(write_pack(&files, &manifest)).unwrap();
        let got: Vec<(String, Vec<u8>)> = pack.files.iter().map(|(p, r)| (p.clone(), pack.data[r.clone()].to_vec())).collect();
        assert_eq!(got, files);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&pack.manifest_json).unwrap(), manifest);
    }

    #[test]
    fn rejects_damaged_data() {
        assert!(Pack::read(b"NOTAPACK....".to_vec()).is_err());
        let mut p = write_pack(&[("/a".to_string(), vec![1; 10])], &serde_json::json!({}));
        p.truncate(p.len() - 1);
        assert!(Pack::read(p).is_err());
    }
}
