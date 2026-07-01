import {
  explainWhatsNewApiError,
  MAX_WHATS_NEW_BYTES,
  validateWhatsNew,
  whatsNewByteLength,
} from "./whats-new";

describe(whatsNewByteLength, () => {
  it("counts UTF-8 bytes, not code points", () => {
    expect(whatsNewByteLength("abc")).toBe(3);
    // A single emoji is 4 UTF-8 bytes.
    expect(whatsNewByteLength("🚀")).toBe(4);
    // "é" (U+00E9) is 2 UTF-8 bytes.
    expect(whatsNewByteLength("é")).toBe(2);
  });
});

describe(validateWhatsNew, () => {
  it("accepts ordinary text", () => {
    expect(validateWhatsNew("Fixed the login crash")).toBeNull();
  });

  it("rejects empty and whitespace-only text", () => {
    expect(validateWhatsNew("")?.reason).toBe("empty");
    expect(validateWhatsNew("   \n\t ")?.reason).toBe("empty");
  });

  it("accepts text exactly at the byte ceiling", () => {
    expect(validateWhatsNew("a".repeat(MAX_WHATS_NEW_BYTES))).toBeNull();
  });

  it("rejects text over the byte ceiling", () => {
    const error = validateWhatsNew("a".repeat(MAX_WHATS_NEW_BYTES + 1));
    expect(error?.reason).toBe("too-long");
    expect(error?.message).toContain(String(MAX_WHATS_NEW_BYTES + 1));
  });

  it("measures the ceiling in bytes, so multi-byte glyphs count more", () => {
    // 2000 emoji = 8000 bytes, well over the 4000-byte ceiling despite 2000 code points.
    expect(validateWhatsNew("🚀".repeat(2000))?.reason).toBe("too-long");
  });

  it("does not guess a minimum length — short strings are accepted client-side", () => {
    // ASC rejects "Fix" server-side, but there is no stable minimum to replicate.
    expect(validateWhatsNew("Fix")).toBeNull();
  });
});

describe(explainWhatsNewApiError, () => {
  it("rewrites Apple's 'too short' rejection", () => {
    const message =
      "An attribute value has text that is too short. - Text for whatsNew is too short.";
    expect(explainWhatsNewApiError(message)).toContain("undocumented minimum length");
  });

  it("returns null for unrelated errors", () => {
    expect(explainWhatsNewApiError("Some other App Store Connect failure")).toBeNull();
    // "too short" about a different attribute is left alone.
    expect(explainWhatsNewApiError("Text for keywords is too short.")).toBeNull();
  });
});
