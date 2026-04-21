export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
