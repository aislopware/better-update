#![deny(clippy::all)]

//! First-party bsdiff patch producer for better-update.
//!
//! Wraps the `qbsdiff` crate (classic bsdiff-4.x / BSDIFF40 producer) behind a
//! minimal, synchronous N-API surface. N-API is ABI-stable and loads under bun,
//! replacing the legacy NAN/V8 `bsdiff-node` addon that segfaults under bun.
//!
//! The surface is intentionally tiny and synchronous: patch generation happens
//! at publish time on a developer/CI machine, not on a hot request path.

use std::fs;
use std::io::Cursor;

use napi::bindgen_prelude::{Buffer, Error, Result, Status};
use napi_derive::napi;
use qbsdiff::Bsdiff;

/// Run qbsdiff over `(old, new)` and return the BSDIFF40 patch bytes.
///
/// qbsdiff does not reproduce bsdiff-4.3 byte-for-byte, but the patch *format*
/// is compatible: 8-byte `BSDIFF40` magic, 32-byte header, three bzip2 streams
/// (control/diff/extra) — exactly what expo-updates 56's bspatch.c applies.
fn diff_bytes(old: &[u8], new: &[u8]) -> Result<Vec<u8>> {
  let mut patch = Vec::new();
  Bsdiff::new(old, new)
    .compare(Cursor::new(&mut patch))
    .map_err(|cause| {
      Error::new(Status::GenericFailure, format!("bsdiff failed to compute a patch: {cause}"))
    })?;
  Ok(patch)
}

/// Read `oldPath` and `newPath`, produce a BSDIFF40 patch, write it to `outPath`.
///
/// Mirrors the `diffSync(oldFile, newFile, patchFile)` signature the CLI's
/// `BsdiffService` already drives, so the binding source can be swapped without
/// touching the Effect port.
#[napi]
pub fn diff_sync(old_path: String, new_path: String, out_path: String) -> Result<()> {
  let old = fs::read(&old_path).map_err(|cause| {
    Error::new(Status::GenericFailure, format!("failed to read old file {old_path}: {cause}"))
  })?;
  let new = fs::read(&new_path).map_err(|cause| {
    Error::new(Status::GenericFailure, format!("failed to read new file {new_path}: {cause}"))
  })?;

  let patch = diff_bytes(&old, &new)?;

  fs::write(&out_path, &patch).map_err(|cause| {
    Error::new(Status::GenericFailure, format!("failed to write patch {out_path}: {cause}"))
  })?;
  Ok(())
}

/// In-memory variant: diff two buffers, return the BSDIFF40 patch buffer.
///
/// Convenience for callers that already hold the bundles in memory or want to
/// avoid temp files; the on-disk `diffSync` is the primary publish-time entry.
#[napi]
pub fn diff_buffer(old: Buffer, new: Buffer) -> Result<Buffer> {
  let patch = diff_bytes(old.as_ref(), new.as_ref())?;
  Ok(patch.into())
}
