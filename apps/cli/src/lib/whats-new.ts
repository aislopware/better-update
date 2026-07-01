/**
 * Client-side validation for the TestFlight "What to Test" (`whatsNew`) text.
 *
 * App Store Connect enforces two rules the CLI can replicate before spending a
 * full binary upload: the text must be non-empty and at most {@link MAX_WHATS_NEW_BYTES}
 * UTF-8 *bytes* (ASC counts bytes, not Unicode characters — multi-byte glyphs like
 * emoji cost more). ASC additionally rejects short strings with an *undocumented*
 * "too short" rule that has no stable, published minimum (a value like `"Fix"` is
 * rejected, and so is `"Bug fixes"` in some reports); we deliberately do NOT guess
 * that threshold — {@link explainWhatsNewApiError} surfaces Apple's own error instead.
 */

/** Maximum `whatsNew` length App Store Connect accepts, in UTF-8 bytes. */
export const MAX_WHATS_NEW_BYTES = 4000;

export interface WhatsNewValidationError {
  readonly reason: "empty" | "too-long";
  readonly message: string;
}

/** Byte length of `text` under UTF-8, matching how ASC counts `whatsNew`. */
export const whatsNewByteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Validate "What to Test" text against the constraints replicable client-side.
 * Returns a {@link WhatsNewValidationError} to reject, or `null` when acceptable.
 */
export const validateWhatsNew = (text: string): WhatsNewValidationError | null => {
  if (text.trim().length === 0) {
    return { reason: "empty", message: "'What to Test' text must not be empty." };
  }
  const bytes = whatsNewByteLength(text);
  if (bytes > MAX_WHATS_NEW_BYTES) {
    return {
      reason: "too-long",
      message: `'What to Test' text is ${String(bytes)} bytes; App Store Connect allows at most ${String(MAX_WHATS_NEW_BYTES)} bytes (UTF-8, so emoji and accented characters cost more than one).`,
    };
  }
  return null;
};

/**
 * Translate App Store Connect's opaque "too short" rejection into an actionable
 * message. Returns `null` for unrelated errors so the caller can keep the original.
 */
export const explainWhatsNewApiError = (message: string): string | null => {
  if (/too short/iu.test(message) && /whatsNew/iu.test(message)) {
    return "App Store Connect rejected the 'What to Test' text as too short. Apple enforces an undocumented minimum length — use a longer, more descriptive message (a terse phrase like \"Fix\" is rejected).";
  }
  return null;
};
