export const getInitial = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

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

const HASH_SEED = 5381;
const HASH_MOD = 2_147_483_647;

const hashString = (value: string): number =>
  Array.from({ length: value.length }, (_, index) => value.codePointAt(index) ?? 0).reduce(
    (hash, code) => (hash * 33 + code) % HASH_MOD,
    HASH_SEED,
  );

export const getAvatarColor = (name: string): string =>
  AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0];
