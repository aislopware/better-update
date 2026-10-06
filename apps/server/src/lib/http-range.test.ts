import {
  multipartByteRanges,
  parseRangeHeader,
  planObjectReads,
  sliceReadChunk,
} from "./http-range";

import type { ByteRange, FramedRange } from "./http-range";

const SIZE = 1000;
const decoder = new TextDecoder();
const encode = (text: string) => new TextEncoder().encode(text);

const framed = (ranges: readonly ByteRange[]): readonly FramedRange[] =>
  ranges.map((range) => ({ ...range, prefix: new Uint8Array(), suffix: new Uint8Array() }));

describe(parseRangeHeader, () => {
  it("reads closed, open-ended and suffix ranges, clamped to the object", () => {
    expect(parseRangeHeader("bytes=0-99", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [{ offset: 0, length: 100 }],
    });
    expect(parseRangeHeader("bytes=900-", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [{ offset: 900, length: 100 }],
    });
    expect(parseRangeHeader("bytes=-50", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [{ offset: 950, length: 50 }],
    });
    expect(parseRangeHeader("bytes=990-5000", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [{ offset: 990, length: 10 }],
    });
    expect(parseRangeHeader("bytes=-5000", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [{ offset: 0, length: 1000 }],
    });
  });

  it("keeps ascending ranges in order, the way electron-updater sends them", () => {
    expect(parseRangeHeader("bytes=0-9, 20-29, 500-999", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [
        { offset: 0, length: 10 },
        { offset: 20, length: 10 },
        { offset: 500, length: 500 },
      ],
    });
  });

  it("answers the whole object for unordered, overlapping or malformed ranges", () => {
    expect(parseRangeHeader("bytes=20-29, 0-9", SIZE)).toStrictEqual({ kind: "ignore" });
    expect(parseRangeHeader("bytes=0-20, 10-29", SIZE)).toStrictEqual({ kind: "ignore" });
    expect(parseRangeHeader("bytes=9-0", SIZE)).toStrictEqual({ kind: "ignore" });
    expect(parseRangeHeader("bytes=-", SIZE)).toStrictEqual({ kind: "ignore" });
    expect(parseRangeHeader("items=0-9", SIZE)).toStrictEqual({ kind: "ignore" });
    expect(parseRangeHeader("bytes=a-b", SIZE)).toStrictEqual({ kind: "ignore" });
    const tooMany = Array.from({ length: 1001 }, (_, index) => `${String(index)}-${String(index)}`);
    expect(parseRangeHeader(`bytes=${tooMany.join(",")}`, 2000)).toStrictEqual({ kind: "ignore" });
  });

  it("is unsatisfiable only when no range overlaps the object", () => {
    expect(parseRangeHeader("bytes=1000-1010", SIZE)).toStrictEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=5000-", SIZE)).toStrictEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", SIZE)).toStrictEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=0-9, 2000-2010", SIZE)).toStrictEqual({
      kind: "ranges",
      ranges: [{ offset: 0, length: 10 }],
    });
  });
});

describe(multipartByteRanges, () => {
  it("frames each range with its part headers and closes the body", () => {
    const ranges = multipartByteRanges({
      ranges: [
        { offset: 0, length: 10 },
        { offset: 20, length: 5 },
      ],
      size: SIZE,
      boundary: "B",
      contentType: "application/octet-stream",
    });
    expect(ranges.map((range) => decoder.decode(range.prefix))).toStrictEqual([
      "--B\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 0-9/1000\r\n\r\n",
      "\r\n--B\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 20-24/1000\r\n\r\n",
    ]);
    expect(ranges.map((range) => decoder.decode(range.suffix))).toStrictEqual([
      "",
      "\r\n--B--\r\n",
    ]);
  });
});

describe(planObjectReads, () => {
  it("shares one read between near ranges and splits at wide gaps", () => {
    const reads = planObjectReads(
      framed([
        { offset: 0, length: 10 },
        { offset: 100, length: 10 },
        { offset: 10_000_000, length: 10 },
      ]),
    );
    expect(
      reads.map(({ offset, length, ranges }) => [offset, length, ranges.length]),
    ).toStrictEqual([
      [0, 110, 2],
      [10_000_000, 10, 1],
    ]);
  });

  it("caps the number of reads by merging the narrowest gaps", () => {
    const spread = Array.from({ length: 1000 }, (_, index) => ({
      offset: index * 1_000_000,
      length: 10,
    }));
    const reads = planObjectReads(framed(spread));
    expect(reads.length).toBeLessThanOrEqual(200);
    expect(reads.flatMap((read) => read.ranges)).toHaveLength(1000);
  });
});

describe(sliceReadChunk, () => {
  it("emits each range's prefix where it starts and only the bytes it covers", () => {
    const [read] = planObjectReads([
      { offset: 2, length: 3, prefix: encode("<a>"), suffix: new Uint8Array() },
      { offset: 8, length: 4, prefix: encode("<b>"), suffix: encode("</>") },
    ]);
    const object = new TextEncoder().encode("0123456789ABCDEF");
    // The read spans offsets 2..11, delivered in chunks that cut through both ranges.
    const pieces = [
      sliceReadChunk(read!, 2, object.subarray(2, 4)),
      sliceReadChunk(read!, 4, object.subarray(4, 9)),
      sliceReadChunk(read!, 9, object.subarray(9, 12)),
    ].flat();
    expect(pieces.map((piece) => decoder.decode(piece))).toStrictEqual([
      "<a>23",
      "4",
      "<b>8",
      "9AB</>",
    ]);
  });
});
