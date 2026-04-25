/// <reference types="vitest/globals" />

import { asRecord, isRecord } from "./index";

describe(isRecord, () => {
  it("detects plain objects", () => {
    expect(isRecord({ key: 1 })).toBe(true);
    expect(isRecord({})).toBe(true);
  });

  it("rejects null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("rejects arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isRecord("x")).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe(asRecord, () => {
  it("returns the value when it is a record", () => {
    const value = { key: 1 };
    expect(asRecord(value)).toBe(value);
  });

  it("returns undefined for non-records", () => {
    expect(asRecord(null)).toBeUndefined();
    expect(asRecord([])).toBeUndefined();
    expect(asRecord("x")).toBeUndefined();
    expect(asRecord(42)).toBeUndefined();
  });
});
