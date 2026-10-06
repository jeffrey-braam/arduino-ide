//! The only WebAssembly the page loads uncompressed (as base64 in the boot script): just enough
//! to unpack the app and the Rust core (crates/wasm). Kept small: no string formatting.

use wasm_bindgen::prelude::*;

/// Decodes an embedded pack (see aide_core::embed) and decompresses it.
#[wasm_bindgen]
pub fn unpack(text: &str) -> Result<Vec<u8>, JsError> {
    let packed = aide_core::embed::decode_text(text).map_err(JsError::new)?;
    aide_core::lzma::unlzma(&packed).map_err(|_| JsError::new("Compressed data is damaged"))
}

/// Like `unpack`, for a pack holding UTF-8 text.
#[wasm_bindgen(js_name = unpackText)]
pub fn unpack_text(text: &str) -> Result<String, JsError> {
    String::from_utf8(unpack(text)?).map_err(|_| JsError::new("Embedded text is damaged"))
}
