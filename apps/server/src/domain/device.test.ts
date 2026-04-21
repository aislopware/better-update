import { inferDeviceClass, isValidIdentifier, normalizeIdentifier } from "./device";

describe(normalizeIdentifier, () => {
  it("trims whitespace", () => {
    expect(normalizeIdentifier("  00008030-001C45663C90802E  ")).toBe("00008030-001c45663c90802e");
  });

  it("lowercases hex", () => {
    expect(normalizeIdentifier("00008030-001C45663C90802E")).toBe("00008030-001c45663c90802e");
  });

  it("preserves dashes", () => {
    expect(normalizeIdentifier("AB-CD")).toBe("ab-cd");
  });
});

describe(isValidIdentifier, () => {
  it("accepts 40-hex legacy UDID", () => {
    expect(isValidIdentifier("abcdef0123456789abcdef0123456789abcdef01")).toBe(true);
  });

  it("accepts 8-16 modern iOS UDID", () => {
    expect(isValidIdentifier("00008030-001c45663c90802e")).toBe(true);
  });

  it("accepts UUID format (Mac)", () => {
    expect(isValidIdentifier("abcdef01-2345-6789-abcd-ef0123456789")).toBe(true);
  });

  it("rejects too short", () => {
    expect(isValidIdentifier("abc")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isValidIdentifier("gggggggg-ggggggggggggggggggg")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidIdentifier("")).toBe(false);
  });
});

describe(inferDeviceClass, () => {
  it("uUID format maps to MAC", () => {
    expect(inferDeviceClass("abcdef01-2345-6789-abcd-ef0123456789")).toBe("MAC");
  });

  it("8-16 format maps to IPHONE", () => {
    expect(inferDeviceClass("00008030-001c45663c90802e")).toBe("IPHONE");
  });

  it("40-hex legacy maps to IPHONE", () => {
    expect(inferDeviceClass("abcdef0123456789abcdef0123456789abcdef01")).toBe("IPHONE");
  });

  it("invalid identifier returns UNKNOWN", () => {
    expect(inferDeviceClass("not-a-udid")).toBe("UNKNOWN");
  });

  it("normalizes before inferring (uppercase UUID → MAC)", () => {
    expect(inferDeviceClass("ABCDEF01-2345-6789-ABCD-EF0123456789")).toBe("MAC");
  });
});
