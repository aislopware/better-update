import { Schema } from "effect";

import { Id, DateTimeString, Platform, PaginationParams } from "./common";

describe(Id, () => {
  test("accepts string", () => {
    const result = Schema.decodeUnknownSync(Id)("abc-123");
    expect(result).toBe("abc-123");
  });

  test("rejects non-string", () => {
    expect(() => Schema.decodeUnknownSync(Id)(123)).toThrow();
  });
});

describe(DateTimeString, () => {
  test("accepts ISO datetime string", () => {
    const result = Schema.decodeUnknownSync(DateTimeString)("2026-01-01T00:00:00Z");
    expect(result).toBe("2026-01-01T00:00:00Z");
  });
});

describe(Platform, () => {
  test("accepts 'ios'", () => {
    expect(Schema.decodeUnknownSync(Platform)("ios")).toBe("ios");
  });

  test("accepts 'android'", () => {
    expect(Schema.decodeUnknownSync(Platform)("android")).toBe("android");
  });

  test("rejects unknown platform", () => {
    expect(() => Schema.decodeUnknownSync(Platform)("web")).toThrow();
  });
});

describe(PaginationParams, () => {
  test("decodes numeric strings to numbers", () => {
    const result = Schema.decodeUnknownSync(PaginationParams)({
      page: "2",
      limit: "25",
    });
    expect(result).toEqual({ page: 2, limit: 25 });
  });

  test("accepts missing optional fields", () => {
    const result = Schema.decodeUnknownSync(PaginationParams)({});
    expect(result).toEqual({});
  });

  test("rejects non-numeric string", () => {
    expect(() => Schema.decodeUnknownSync(PaginationParams)({ page: "abc" })).toThrow();
  });
});
