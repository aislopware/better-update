/// <reference types="vitest/globals" />

import { fromBase64, fromBase64Url, fromHex, toBase64, toBase64Url, toHex } from "./index";

const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

describe("encoding helpers", () => {
  it("round-trips base64", () => {
    expect([...fromBase64(toBase64(bytes))]).toStrictEqual([...bytes]);
  });

  it("round-trips unpadded base64url", () => {
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toContain("=");
    expect([...fromBase64Url(encoded)]).toStrictEqual([...bytes]);
  });

  it("round-trips hex", () => {
    expect(toHex(fromHex("000102fdfeff"))).toBe("000102fdfeff");
  });

  it("rejects malformed hex", () => {
    expect(() => fromHex("abc")).toThrow(RangeError);
    expect(() => fromHex("zz")).toThrow(RangeError);
  });

  it("rejects malformed base64 variants", () => {
    expect(() => fromBase64("abcde")).toThrow(RangeError);
    expect(() => fromBase64Url("abc*def")).toThrow(RangeError);
  });
});
