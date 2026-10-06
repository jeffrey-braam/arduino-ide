//! The only WebAssembly the page loads uncompressed (as base64 in the boot script): just enough
//! to unpack the app, which carries the rest (crates/wasm).

use wasm_bindgen::prelude::*;

/// Decodes an embedded pack (see aide_core::embed) and decompresses it to text.
#[wasm_bindgen(js_name = unpackText)]
pub fn unpack_text(text: &str) -> Result<String, JsError> {
    let bytes = aide_core::lzma::unlzma(&aide_core::embed::decode_text(text))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
