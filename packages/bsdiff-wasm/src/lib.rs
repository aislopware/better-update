use wasm_bindgen::prelude::*;
use std::io::Cursor;

/// Generate a binary diff patch from old and new byte arrays.
/// Returns the patch as a Uint8Array.
#[wasm_bindgen]
pub fn diff(old: &[u8], new: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut patch = Vec::new();
    bsdiff::diff(old, new, &mut patch)
        .map_err(|e| JsValue::from_str(&format!("bsdiff error: {}", e)))?;
    Ok(patch)
}

/// Apply a binary diff patch to reconstruct the new byte array.
/// Returns the reconstructed data as a Uint8Array.
#[wasm_bindgen]
pub fn patch(old: &[u8], patch_data: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut output = Vec::new();
    let mut cursor = Cursor::new(patch_data);
    bsdiff::patch(old, &mut cursor, &mut output)
        .map_err(|e| JsValue::from_str(&format!("bspatch error: {}", e)))?;
    Ok(output)
}
