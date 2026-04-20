import { inferDeviceClass, isValidIdentifier, normalizeIdentifier } from "./device";

describe(normalizeIdentifier, () => {
  test("trims whitespace", () => {
    expect(normalizeIdentifier("  00008030-001C45663C90802E  ")).toBe("00008030-001c45663c90802e");
  });

  test("lowercases hex", () => {
    expect(normalizeIdentifier("00008030-001C45663C90802E")).toBe("00008030-001c45663c90802e");
  });

  test("preserves dashes", () => {
    expect(normalizeIdentifier("AB-CD")).toBe("ab-cd");
  });
});

describe(isValidIdentifier, () => {
  test("accepts 40-hex legacy UDID", () => {
    expect(isValidIdentifier("abcdef0123456789abcdef0123456789abcdef01")).toBe(true);
  });

  test("accepts 8-16 modern iOS UDID", () => {
    expect(isValidIdentifier("00008030-001c45663c90802e")).toBe(true);
  });

  test("accepts UUID format (Mac)", () => {
    expect(isValidIdentifier("abcdef01-2345-6789-abcd-ef0123456789")).toBe(true);
  });

  test("rejects too short", () => {
    expect(isValidIdentifier("abc")).toBe(false);
  });

  test("rejects non-hex characters", () => {
    expect(isValidIdentifier("gggggggg-ggggggggggggggggggg")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isValidIdentifier("")).toBe(false);
  });
});

describe(inferDeviceClass, () => {
  test("UUID format maps to MAC", () => {
    expect(inferDeviceClass("abcdef01-2345-6789-abcd-ef0123456789")).toBe("MAC");
  });

  test("8-16 format maps to IPHONE", () => {
    expect(inferDeviceClass("00008030-001c45663c90802e")).toBe("IPHONE");
  });

  test("40-hex legacy maps to IPHONE", () => {
    expect(inferDeviceClass("abcdef0123456789abcdef0123456789abcdef01")).toBe("IPHONE");
  });

  test("invalid identifier returns UNKNOWN", () => {
    expect(inferDeviceClass("not-a-udid")).toBe("UNKNOWN");
  });

  test("normalizes before inferring (uppercase UUID → MAC)", () => {
    expect(inferDeviceClass("ABCDEF01-2345-6789-ABCD-EF0123456789")).toBe("MAC");
  });
});
