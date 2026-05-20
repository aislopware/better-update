export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

// Normalize `T | null | undefined` to `T | undefined` — boundary helper for
// converting nullable values into optional ones at the type-system level.
// eslint-disable-next-line eslint-js/no-restricted-syntax -- boundary helper; raw `?? undefined` is banned elsewhere
export const toOptional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

// Remove own keys whose value is `undefined`. Required keys stay required;
// possibly-undefined keys become optional with `undefined` excluded — so the
// result is assignable to schemas under `exactOptionalPropertyTypes` without
// per-field `...(x === undefined ? {} : { x })` spreads.
export const compact = <T extends Record<string, unknown>>(obj: T): Compacted<T> =>
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- runtime filters undefined keys so the resulting shape matches the Compacted<T> mapped type
  Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as Compacted<T>;
