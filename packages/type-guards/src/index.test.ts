/// <reference types="vitest/globals" />

import { asRecord, asVersionSlot, compact, isRecord, toOptional } from "./index";

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

describe(compact, () => {
  it("removes keys with undefined values", () => {
    expect(compact({ alpha: 1, beta: undefined, gamma: "x" })).toStrictEqual({
      alpha: 1,
      gamma: "x",
    });
  });

  it("preserves null values", () => {
    expect(compact({ alpha: null, beta: undefined })).toStrictEqual({ alpha: null });
  });

  it("preserves falsy values that are not undefined", () => {
    expect(compact({ zero: 0, empty: "", flag: false, missing: undefined })).toStrictEqual({
      zero: 0,
      empty: "",
      flag: false,
    });
  });

  it("returns an empty object when every value is undefined", () => {
    expect(compact({ alpha: undefined, beta: undefined })).toStrictEqual({});
  });

  it("returns an empty object for empty input", () => {
    expect(compact({})).toStrictEqual({});
  });

  it("does not include inherited keys", () => {
    const base = { inherited: 1 };
    const input = Object.create(base) as Record<string, unknown>;
    input["own"] = "x";
    expect(compact(input)).toStrictEqual({ own: "x" });
  });
});

describe(asVersionSlot, () => {
  it("passes a string through", () => {
    expect(asVersionSlot("41")).toBe("41");
    expect(asVersionSlot("6.0.5")).toBe("6.0.5");
  });

  it("stringifies an integer (eas.json android.versionCode)", () => {
    expect(asVersionSlot(41)).toBe("41");
    expect(asVersionSlot(0)).toBe("0");
  });

  it("keeps a malformed number visible instead of reading as absent", () => {
    // Callers validate the string form and report it back to the user; mapping
    // it to undefined here would make them fall through to a default.
    expect(asVersionSlot(4.1)).toBe("4.1");
  });

  it("rejects non-finite numbers and non-scalars", () => {
    expect(asVersionSlot(Number.NaN)).toBeUndefined();
    expect(asVersionSlot(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(asVersionSlot(null)).toBeUndefined();
    expect(asVersionSlot(undefined)).toBeUndefined();
    expect(asVersionSlot(true)).toBeUndefined();
    expect(asVersionSlot({ versionCode: 41 })).toBeUndefined();
  });
});

describe(toOptional, () => {
  it("returns undefined for null", () => {
    expect(toOptional(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(toOptional(undefined)).toBeUndefined();
  });

  it("returns the value otherwise", () => {
    expect(toOptional("x")).toBe("x");
    expect(toOptional(0)).toBe(0);
    expect(toOptional(false)).toBe(false);
    expect(toOptional("")).toBe("");
  });
});
