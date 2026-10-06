/**
 * The blockmap electron-updater downloads a `.zip` update differentially
 * with: the file cut into content-defined chunks, each named by a checksum.
 * The updater keeps the previous update's zip, compares its blockmap with the
 * new one's, copies the chunks they share and fetches only the rest with HTTP
 * range requests.
 *
 * Chunk boundaries come from a gear rolling hash (FastCDC with normalized
 * chunking), so they depend on the bytes around them, not on offsets: an
 * insertion shifts later content without changing its chunks. The updater
 * matches chunks by checksum string and size only, so it needs both blockmaps
 * to come from this chunker, which the server guarantees by serving only the
 * blockmaps the CLI computed.
 */
import { createHash } from "node:crypto";

export interface ElectronBlockmapChunks {
  readonly checksums: readonly string[];
  readonly sizes: readonly number[];
}

const MIN_CHUNK = 16 * 1024;
const AVERAGE_CHUNK = 64 * 1024;
const MAX_CHUNK = 256 * 1024;
/**
 * A boundary is a hash whose top bits are zero: 18 of them before the average
 * size (rarely cut), 14 after (cut soon), which narrows the size spread.
 */
const CUT_BEFORE_AVERAGE = 2 ** (32 - 18);
const CUT_AFTER_AVERAGE = 2 ** (32 - 14);
/** 18 bytes of SHA-256: 24 base64 characters, no collision in practice. */
const CHECKSUM_BYTES = 18;

/** 256 fixed pseudo-random 32-bit values, one per byte value. */
const GEAR = Uint32Array.from({ length: 256 }, (_, index) =>
  createHash("sha256")
    .update(`better-update blockmap gear ${String(index)}`)
    .digest()
    .readUInt32BE(0),
);

/** The end of the chunk that starts at `start`. */
const chunkEnd = (bytes: Uint8Array, start: number): number => {
  const end = Math.min(start + MAX_CHUNK, bytes.length);
  if (end - start <= MIN_CHUNK) {
    return end;
  }
  const average = Math.min(start + AVERAGE_CHUNK, end);
  let hash = 0;
  for (let index = start + MIN_CHUNK; index < end; index += 1) {
    // eslint-disable-next-line eslint-js/no-bitwise -- the gear hash is 32-bit shift-and-add
    hash = ((hash << 1) + (GEAR[bytes[index] ?? 0] ?? 0)) >>> 0;
    if (hash < (index < average ? CUT_BEFORE_AVERAGE : CUT_AFTER_AVERAGE)) {
      return index + 1;
    }
  }
  return end;
};

const checksumOf = (chunk: Uint8Array): string =>
  createHash("sha256").update(chunk).digest().subarray(0, CHECKSUM_BYTES).toString("base64");

interface Chunk {
  readonly start: number;
  readonly end: number;
}

/** The chunks of `bytes`, in order and back to back. */
const chunksOf = (bytes: Uint8Array): readonly Chunk[] => {
  const chunks: Chunk[] = [];
  for (let start = 0; start < bytes.length;) {
    const end = chunkEnd(bytes, start);
    chunks.push({ start, end });
    start = end;
  }
  return chunks;
};

/** The blockmap chunks of an archive: what `macos release create` uploads for a zip. */
export const electronBlockmap = (bytes: Uint8Array): ElectronBlockmapChunks => {
  const chunks = chunksOf(bytes);
  return {
    checksums: chunks.map(({ start, end }) => checksumOf(bytes.subarray(start, end))),
    sizes: chunks.map(({ start, end }) => end - start),
  };
};
