/**
 * Parse a human-readable duration flag ("90", "45m", "2h", "1h30m") into
 * milliseconds. A bare number means minutes. Returns `undefined` for anything
 * unparseable or non-positive — range policy stays with the caller.
 */
export const parseDurationMs = (input: string): number | undefined => {
  const groups = /^(?:(?<hours>\d+)h)?(?:(?<minutes>\d+)m?)?$/u.exec(
    input.trim().toLowerCase(),
  )?.groups;
  if (!groups || (groups["hours"] === undefined && groups["minutes"] === undefined)) {
    return undefined;
  }
  const hours = Number(groups["hours"] ?? 0);
  const minutes = Number(groups["minutes"] ?? 0);
  const ms = (hours * 60 + minutes) * 60_000;
  return ms > 0 ? ms : undefined;
};

/**
 * Approximate human form of a duration, rounded up to whole minutes so
 * "<1 min remaining" still reads as 1 — "45 min", "2 h", "1 h 30 min".
 */
export const formatDurationApprox = (ms: number): string => {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
};
