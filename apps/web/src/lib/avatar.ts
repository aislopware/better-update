export const getInitial = (seed: string): string => (seed.trim()[0] ?? "?").toUpperCase();

const AVATAR_PALETTE = [
  "#ef4444",
  "#f97316",
  "#d97706",
  "#65a30d",
  "#059669",
  "#0891b2",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#c026d3",
  "#db2777",
  "#e11d48",
] as const;

// Djb2 hash seed + modulus; iterate code points (not code units) so surrogate pairs count once
const HASH_SEED = 5381;
const HASH_MOD = 2_147_483_647;

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const hashString = (value: string): number =>
  [...segmenter.segment(value)].reduce(
    (hash, { segment }) => (hash * 33 + (segment.codePointAt(0) ?? 0)) % HASH_MOD,
    HASH_SEED,
  );

export const getAvatarColor = (seed: string): string =>
  AVATAR_PALETTE[hashString(seed) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0];
