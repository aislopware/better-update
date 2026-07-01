// Shared logo-upload rules for the project and organization logo features: both
// upload to the assets bucket via a presigned PUT that can't cap its own size or
// fully constrain its type, so the finalize step re-validates the stored object
// against the same cap and allow-list.

// The presigned PUT expires fast; the upload is a quick precursor to the
// finalize (`setLogo`) call.
export const LOGO_UPLOAD_EXPIRY_SECONDS = 600;

// Hard cap (2 MiB) enforced post-upload.
export const MAX_LOGO_BYTES = 2_097_152;

export const LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

/**
 * Validate an uploaded logo object's stored metadata against the size cap and the
 * allowed image types. Returns a human-readable rejection reason, or `null` when
 * the object is acceptable. A `null` content type (R2 didn't record one) passes —
 * the presigned PUT already signed an allowed type at request time.
 */
export const logoRejectionReason = (params: {
  readonly size: number;
  readonly contentType: string | null;
}): string | null => {
  if (params.size > MAX_LOGO_BYTES) {
    return "Logo must be 2 MB or smaller";
  }
  if (params.contentType !== null && !LOGO_CONTENT_TYPES.has(params.contentType)) {
    return `Unsupported logo type: ${params.contentType}`;
  }
  return null;
};
