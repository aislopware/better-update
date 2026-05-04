import { decodeCursor, encodeCursor, parseCursorPagination } from "./cursor";

describe(encodeCursor, () => {
  it("encodes to base64 of JSON payload", () => {
    const encoded = encodeCursor({ createdAt: "2026-05-03T10:00:00.000Z", id: "abc" });
    expect(encoded).toBe(
      btoa(JSON.stringify({ createdAt: "2026-05-03T10:00:00.000Z", id: "abc" })),
    );
  });
});

describe(decodeCursor, () => {
  it("roundtrips with encodeCursor", () => {
    const original = { createdAt: "2026-05-03T10:00:00.000Z", id: "01F8MECHZX3TBDSZ7XR8ZJ8K9R" };
    expect(decodeCursor(encodeCursor(original))).toStrictEqual(original);
  });

  it("returns null for empty string", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for malformed base64", () => {
    expect(decodeCursor("not-valid-base64-!!!")).toBeNull();
  });

  it("returns null when JSON is missing required fields", () => {
    expect(
      decodeCursor(btoa(JSON.stringify({ createdAt: "2026-05-03T10:00:00.000Z" }))),
    ).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ id: "abc" })))).toBeNull();
    expect(decodeCursor(btoa("{}"))).toBeNull();
  });

  it("returns null when fields are not strings", () => {
    expect(decodeCursor(btoa(JSON.stringify({ createdAt: 123, id: "abc" })))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ createdAt: "x", id: 456 })))).toBeNull();
  });

  it("returns null when JSON payload is not an object", () => {
    expect(decodeCursor(btoa(JSON.stringify("string")))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify(null)))).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify([1, 2])))).toBeNull();
  });
});

describe(parseCursorPagination, () => {
  it("returns null cursor when none provided", () => {
    expect(parseCursorPagination({})).toStrictEqual({ cursor: null, limit: 50 });
  });

  it("decodes provided cursor", () => {
    const cursor = encodeCursor({ createdAt: "2026-05-03T10:00:00.000Z", id: "abc" });
    expect(parseCursorPagination({ cursor })).toStrictEqual({
      cursor: { createdAt: "2026-05-03T10:00:00.000Z", id: "abc" },
      limit: 50,
    });
  });

  it("returns null cursor when decode fails", () => {
    expect(parseCursorPagination({ cursor: "garbage!!" })).toStrictEqual({
      cursor: null,
      limit: 50,
    });
  });

  it("clamps limit between 1 and maxLimit", () => {
    expect(parseCursorPagination({ limit: 0 }).limit).toBe(1);
    expect(parseCursorPagination({ limit: -5 }).limit).toBe(1);
    expect(parseCursorPagination({ limit: 9999 }).limit).toBe(100);
    expect(parseCursorPagination({ limit: 25 }).limit).toBe(25);
  });

  it("respects custom defaultLimit and maxLimit", () => {
    expect(parseCursorPagination({}, 20, 50).limit).toBe(20);
    expect(parseCursorPagination({ limit: 999 }, 20, 50).limit).toBe(50);
  });
});
