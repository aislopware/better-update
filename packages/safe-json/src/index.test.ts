/// <reference types="vitest/globals" />

import { parseJsonResult, safeJsonParse } from "./index";

describe(parseJsonResult, () => {
  it("distinguishes malformed JSON from a valid JSON null", () => {
    expect(parseJsonResult("null")).toStrictEqual({ ok: true, value: null });
    expect(parseJsonResult("not json")).toStrictEqual({ ok: false });
  });
});

describe(safeJsonParse, () => {
  it("returns parsed JSON values", () => {
    expect(safeJsonParse('{"ok":true}')).toStrictEqual({ ok: true });
  });

  it("returns null for malformed JSON", () => {
    expect(safeJsonParse("not json")).toBeNull();
  });

  it("preserves JSON null", () => {
    expect(safeJsonParse("null")).toBeNull();
  });
});
