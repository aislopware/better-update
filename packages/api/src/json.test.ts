import { safeJsonParse } from "./json";

describe(safeJsonParse, () => {
  test("returns parsed JSON for valid input", () => {
    expect(safeJsonParse('{"ok":true}')).toEqual({ ok: true });
  });

  test("returns null for invalid JSON", () => {
    expect(safeJsonParse("not-json")).toBeNull();
  });
});
