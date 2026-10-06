import { createHash } from "node:crypto";

import { electronBlockmap } from "./electron-blockmap";

/** Deterministic incompressible bytes: a SHA-256 counter stream. */
const pseudoRandom = (length: number, seed: string): Uint8Array => {
  const blocks = Array.from({ length: Math.ceil(length / 32) }, (_, index) =>
    createHash("sha256")
      .update(`${seed}:${String(index)}`)
      .digest(),
  );
  return new Uint8Array(Buffer.concat(blocks).subarray(0, length));
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe(electronBlockmap, () => {
  const bytes = pseudoRandom(3 * 1024 * 1024, "archive");
  const blockmap = electronBlockmap(bytes);

  it("covers the whole file with one checksum per chunk", () => {
    expect(sum(blockmap.sizes)).toBe(bytes.length);
    expect(blockmap.checksums).toHaveLength(blockmap.sizes.length);
    expect(blockmap.checksums.every((checksum) => /^[A-Za-z0-9+/]{24}$/u.test(checksum))).toBe(
      true,
    );
  });

  it("cuts chunks between 16 KiB and 256 KiB, the last one possibly shorter", () => {
    const allButLast = blockmap.sizes.slice(0, -1);
    expect(Math.min(...allButLast)).toBeGreaterThanOrEqual(16 * 1024);
    expect(Math.max(...blockmap.sizes)).toBeLessThanOrEqual(256 * 1024);
    // Content-defined, not fixed-size: around the 64 KiB target on average.
    expect(bytes.length / blockmap.sizes.length).toBeGreaterThan(40 * 1024);
    expect(bytes.length / blockmap.sizes.length).toBeLessThan(120 * 1024);
  });

  it("is deterministic", () => {
    expect(electronBlockmap(bytes)).toStrictEqual(blockmap);
  });

  it("keeps the chunks after an insertion, so a shifted file still mostly matches", () => {
    const inserted = new Uint8Array(
      Buffer.concat([
        bytes.subarray(0, 100_000),
        pseudoRandom(777, "insert"),
        bytes.subarray(100_000),
      ]),
    );
    const shifted = electronBlockmap(inserted);
    const known = new Set(blockmap.checksums);
    const reusedBytes = sum(
      shifted.sizes.filter((_, index) => known.has(shifted.checksums[index] ?? "")),
    );
    expect(reusedBytes / inserted.length).toBeGreaterThan(0.9);
  });

  it("maps a file below the minimum chunk to one chunk, and an empty file to none", () => {
    expect(electronBlockmap(bytes.subarray(0, 1000)).sizes).toStrictEqual([1000]);
    expect(electronBlockmap(new Uint8Array())).toStrictEqual({ checksums: [], sizes: [] });
  });
});
