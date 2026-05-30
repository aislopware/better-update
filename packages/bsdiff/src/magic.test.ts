import { BSDIFF40_MAGIC, hasBsdiff40Magic } from "./magic";

describe("hasBsdiff40Magic", () => {
  test("accepts a buffer that starts with the BSDIFF40 magic", () => {
    const patch = Buffer.concat([Buffer.from(BSDIFF40_MAGIC, "latin1"), Buffer.alloc(32, 0)]);
    expect(hasBsdiff40Magic(patch)).toBe(true);
  });

  test("accepts exactly the 8 magic bytes with no trailing data", () => {
    expect(hasBsdiff40Magic(Buffer.from(BSDIFF40_MAGIC, "latin1"))).toBe(true);
  });

  test("rejects the ENDSLEY/BSDIFF43 magic that bspatch.c refuses", () => {
    expect(hasBsdiff40Magic(Buffer.from("ENDSLEY/BSDIFF43", "latin1"))).toBe(false);
  });

  test("rejects a truncated magic", () => {
    expect(hasBsdiff40Magic(Buffer.from("BSDIFF4", "latin1"))).toBe(false);
  });

  test("rejects an empty buffer", () => {
    expect(hasBsdiff40Magic(new Uint8Array(0))).toBe(false);
  });

  test("ignores bytes past the 8-byte magic", () => {
    const tampered = Buffer.concat([
      Buffer.from(BSDIFF40_MAGIC, "latin1"),
      Buffer.from("anything-after-is-irrelevant"),
    ]);
    expect(hasBsdiff40Magic(tampered)).toBe(true);
  });
});
