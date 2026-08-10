export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

// A native version slot (`ios.buildNumber` / `android.versionCode`) as it is
// spelled in hand-written JSON. EAS types `versionCode` as an integer and
// `buildNumber` as a string, and Expo's app.json is the mirror image, so both
// spellings reach us for both fields. Normalize either to the string form the
// native writers and build metadata use. Any finite number is stringified —
// a malformed `1.5` stays visible as "1.5" for the caller that validates it,
// rather than reading as "absent" and silently taking a default.
export const asVersionSlot = (value: unknown): string | undefined =>
  typeof value === "string" ? value : asFiniteString(value);

const asFiniteString = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;

// Normalize `T | null | undefined` to `T | undefined` — boundary helper for
// converting nullable values into optional ones at the type-system level.
// eslint-disable-next-line eslint-js/no-restricted-syntax -- boundary helper; raw `?? undefined` is banned elsewhere
export const toOptional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

// Normalize `T | null | undefined` to `T | null` — boundary helper for
// converting optional values into nullable DB columns at the type-system level.
// eslint-disable-next-line eslint-js/no-restricted-syntax -- boundary helper; raw `?? null` is banned elsewhere
export const toDbNull = <T>(value: T | null | undefined): T | null => value ?? null;

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
