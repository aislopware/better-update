/**
 * HTTP range requests (RFC 9110 §14) over a stored object of known size: the
 * `Range` header parsed into byte ranges, the `multipart/byteranges` framing
 * of several of them, and the object reads that produce the bytes — adjacent
 * ranges share one read, so a request for a thousand chunks (what
 * electron-updater's differential download asks for) stays a few dozen reads.
 */

export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

/** What the server does with a `Range` header. */
export type RangeRequest =
  /** Serve the whole object, as if there were no header (malformed or not worth it). */
  | { readonly kind: "ignore" }
  /** 416: no range overlaps the object. */
  | { readonly kind: "unsatisfiable" }
  | { readonly kind: "ranges"; readonly ranges: readonly [ByteRange, ...ByteRange[]] };

/** More ranges than electron-updater sends in one request (1000) are refused service, not failed. */
const MAX_RANGES = 1000;
const RANGE_SPEC = /^(?<first>\d*)-(?<last>\d*)$/u;

/** One `first-last` / `first-` / `-suffix` spec: a range, `null` when outside the object, `undefined` when malformed. */
const parseSpec = (spec: string, size: number): ByteRange | null | undefined => {
  const groups = RANGE_SPEC.exec(spec.trim())?.groups;
  const first = groups?.["first"];
  const last = groups?.["last"];
  if (first === undefined || last === undefined || (first === "" && last === "")) {
    return undefined;
  }
  if (first === "") {
    const suffix = Number(last);
    return suffix === 0 || size === 0
      ? null
      : { offset: Math.max(0, size - suffix), length: Math.min(suffix, size) };
  }
  const offset = Number(first);
  if (last !== "" && Number(last) < offset) {
    return undefined;
  }
  if (offset >= size) {
    return null;
  }
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return { offset, length: end - offset + 1 };
};

/**
 * Several ranges are served only in ascending, non-overlapping order (as
 * electron-updater asks); anything else is answered with the whole object,
 * which RFC 9110 allows.
 */
const isAscending = (ranges: readonly ByteRange[]) =>
  ranges.every((range, index) => {
    const previous = ranges[index - 1];
    return previous === undefined || range.offset >= previous.offset + previous.length;
  });

export const parseRangeHeader = (header: string, size: number): RangeRequest => {
  const match = /^bytes=(?<specs>.+)$/iu.exec(header.trim());
  const specs = match?.groups?.["specs"]?.split(",") ?? [];
  if (specs.length === 0 || specs.length > MAX_RANGES) {
    return { kind: "ignore" };
  }
  const parsed = specs.map((spec) => parseSpec(spec, size));
  if (parsed.includes(undefined)) {
    return { kind: "ignore" };
  }
  const [first, ...rest] = parsed.filter(
    (range): range is ByteRange => range !== null && range !== undefined,
  );
  if (first === undefined) {
    return { kind: "unsatisfiable" };
  }
  const ranges: readonly [ByteRange, ...ByteRange[]] = [first, ...rest];
  return ranges.length > 1 && !isAscending(ranges)
    ? { kind: "ignore" }
    : { kind: "ranges", ranges };
};

export const contentRange = (range: ByteRange, size: number) =>
  `bytes ${String(range.offset)}-${String(range.offset + range.length - 1)}/${String(size)}`;

/**
 * A range of the object between literal bytes: a multipart part's headers
 * before it and, after the last part, the closing delimiter.
 */
export interface FramedRange extends ByteRange {
  readonly prefix: Uint8Array;
  readonly suffix: Uint8Array;
}

/** One read of the object, covering the ranges it serves (and the gaps between them). */
export interface ObjectRead extends ByteRange {
  readonly ranges: readonly FramedRange[];
}

const encoder = new TextEncoder();

/** `multipart/byteranges` (RFC 9110 §14.6): each range under its own part headers. */
export const multipartByteRanges = (params: {
  readonly ranges: readonly ByteRange[];
  readonly size: number;
  readonly boundary: string;
  readonly contentType: string;
}): readonly FramedRange[] =>
  params.ranges.map((range, index) => ({
    ...range,
    prefix: encoder.encode(
      `${index === 0 ? "" : "\r\n"}--${params.boundary}\r\nContent-Type: ${params.contentType}\r\nContent-Range: ${contentRange(range, params.size)}\r\n\r\n`,
    ),
    suffix:
      index === params.ranges.length - 1
        ? encoder.encode(`\r\n--${params.boundary}--\r\n`)
        : new Uint8Array(),
  }));

const concatBytes = (parts: readonly Uint8Array[]): Uint8Array => {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  parts.reduce((offset, part) => {
    joined.set(part, offset);
    return offset + part.length;
  }, 0);
  return joined;
};

/** Ranges this close share a read: re-reading a small gap is cheaper than another request. */
const MERGE_GAP = 256 * 1024;
/** Few enough reads for any plan's per-request subrequest budget. */
const MAX_READS = 200;

/**
 * Group ascending ranges into reads: neighbours closer than {@link MERGE_GAP}
 * always share one, and the widest gaps alone stay split once there would be
 * more than {@link MAX_READS} reads.
 */
export const planObjectReads = (ranges: readonly FramedRange[]): readonly ObjectRead[] => {
  const gaps = ranges.slice(1).map((range, index) => {
    const previous = ranges[index];
    return previous === undefined ? 0 : range.offset - (previous.offset + previous.length);
  });
  const widest = gaps.toSorted((left, right) => right - left);
  const threshold = Math.max(MERGE_GAP, widest[MAX_READS - 1] ?? 0);
  const starts = ranges.flatMap((_, index) =>
    index === 0 || (gaps[index - 1] ?? 0) > threshold ? [index] : [],
  );
  return starts.flatMap((start, index) => {
    const group = ranges.slice(start, starts[index + 1]);
    const [first] = group;
    const last = group.at(-1);
    return first === undefined || last === undefined
      ? []
      : [{ offset: first.offset, length: last.offset + last.length - first.offset, ranges: group }];
  });
};

/**
 * What one chunk of a read's bytes (starting at object offset `chunkOffset`)
 * contributes to the response: for each range it overlaps, the part of the
 * range it holds — after the range's prefix where the range begins, before
 * its suffix where the range ends.
 */
export const sliceReadChunk = (
  read: ObjectRead,
  chunkOffset: number,
  chunk: Uint8Array,
): readonly Uint8Array[] =>
  read.ranges.flatMap((range) => {
    const rangeEnd = range.offset + range.length;
    const start = Math.max(range.offset, chunkOffset);
    const end = Math.min(rangeEnd, chunkOffset + chunk.length);
    if (start >= end) {
      return [];
    }
    const bytes = chunk.subarray(start - chunkOffset, end - chunkOffset);
    const prefix = start === range.offset ? range.prefix : new Uint8Array();
    const suffix = end === rangeEnd ? range.suffix : new Uint8Array();
    return [
      prefix.length === 0 && suffix.length === 0 ? bytes : concatBytes([prefix, bytes, suffix]),
    ];
  });
