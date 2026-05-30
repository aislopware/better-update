import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { parseDictionary, parseList, serializeDictionary } from "structured-headers";

import type { DictionaryObject, InnerList, Item, Parameters } from "structured-headers";

// Pure Structured Field Values (SFV-0, a subset of RFC 8941) helpers for the
// expo-updates-1 protocol. The codebase already depends on structured-headers
// (used for expo-extra-params + expo-sfv-version emission) — reuse it; do NOT
// hand-roll SFV parsing/serialization.
//
// `protocol/` is a pure leaf: no I/O, no Effect, no repositories, no cloudflare.
// Every function here is a total sync function that never throws. Both the
// INGEST/parse side (parseList) and the EMIT/serialize side (serializeDictionary)
// of structured-headers throw on malformed/non-conformant input, so each library
// call is wrapped in a safe helper (parseListSafe / serializeDictionarySafe) that
// degrades to a safe default ([] / undefined / "") — a malformed wire value or a
// non-SFV-conformant stored filter can never break manifest selection or emission
// (anti-brick: an absent expo-manifest-filters header is treated by the client as
// `nil` => all updates pass, identical to today).

// The device sends at most 5 recent-failed ids (FileDownloader LIMIT 5); bound
// server work to mirror that even if a peer sends more.
const RECENT_FAILED_IDS_LIMIT = 5;

// An SFV List member is either an Item (a `[BareItem, Parameters]` 2-tuple) or
// an InnerList (a `[Item[], Parameters]` 2-tuple whose first element is an
// array of Items). A bare string Item has a `string` BareItem at index 0.
const isStringItem = (member: Item | InnerList): member is [string, Parameters] =>
  !Array.isArray(member[0]) && typeof member[0] === "string";

/**
 * Parse `Expo-Recent-Failed-Update-IDs` — an Expo SFV-0 OUTER LIST of string
 * items (the wire shape `"uuid1", "uuid2"` per FileDownloader serialization).
 *
 * Each bare string member is trim-lowercased (UUIDs are lowercase on the wire).
 * Inner-lists and non-string items are dropped. A ParseError (malformed header)
 * returns `[]` — a malformed header must never break selection. Capped to the
 * first 5 ids to bound server work.
 */
export const parseRecentFailedUpdateIds = (raw: string | undefined): readonly string[] => {
  if (!raw) {
    return [];
  }
  const parsed = parseListSafe(raw);
  if (parsed === undefined) {
    return [];
  }
  return parsed
    .filter(isStringItem)
    .map((member) => member[0].trim().toLowerCase())
    .filter((id) => id.length > 0)
    .slice(0, RECENT_FAILED_IDS_LIMIT);
};

const parseListSafe = (raw: string): ReturnType<typeof parseList> | undefined => {
  // eslint-disable-next-line functional/no-try-statements -- structured-headers parseList throws ParseError on malformed input; convert to a safe undefined so a bad header degrades to [] rather than breaking selection
  try {
    return parseList(raw);
  } catch {
    return undefined;
  }
};

// The SFV-0 dictionary item domain is scalar only: string / integer / decimal /
// boolean. Arrays, nested objects and null are NOT representable as dictionary
// item values, so they are dropped when ingesting the stored JSON.
const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

// SFV-0 dictionary KEY grammar (RFC 8941 §3.2 key) as enforced by
// structured-headers' serializeKey: lowercase letter or `*` start, then
// `[*\-_.a-z0-9]`. A non-conformant key (uppercase, leading digit, space, etc.)
// makes serializeDictionary THROW, so keys that cannot round-trip are dropped at
// ingest — keeping the stored data, the emitted header, and the server-side
// matchesFilters narrowing mutually consistent. Requiring lowercase keys here is
// also the canonical filter-key contract: matchesFilters compares the filter key
// VERBATIM (no lowercasing) against lowercased metadata keys, exactly like the
// device's SelectionPolicies — see domain/manifest-filters.ts.
const sfvKeyRe = /^[a-z*][*\-_.a-z0-9]*$/u;

// SFV-0 STRING values must be printable ASCII (RFC 8941 §3.3.3 / serializeString
// rejects anything outside 0x20–0x7E). A non-ASCII string (e.g. "café", emoji)
// makes serializeString THROW.
const sfvAsciiRe = /^[\u0020-\u007E]*$/u;

// SFV-0 INTEGERS are bounded to ±(10^15 − 1); serializeInteger throws outside it.
// (Non-integer numbers route to the decimal serializer, which tolerates the JSON
// number range we produce, so only integers need the explicit bound.)
const SFV_INTEGER_MIN = -999_999_999_999_999;
const SFV_INTEGER_MAX = 999_999_999_999_999;

// True only for scalars that structured-headers can actually serialize as an
// SFV-0 dictionary item value — so the stored filter, the emitted header, and the
// server-side narrowing stay consistent (P1: emit can never throw; P3/P4: ingest
// and emit are symmetric).
const isSerializableScalarValue = (value: string | number | boolean): boolean => {
  if (typeof value === "string") {
    return sfvAsciiRe.test(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return false;
    }
    return Number.isInteger(value) ? value >= SFV_INTEGER_MIN && value <= SFV_INTEGER_MAX : true;
  }
  return true;
};

/**
 * Parse the P0c-stored `project_protocol_metadata.manifest_filters_json` value
 * into a scalar map suitable for SFV dictionary serialization.
 *
 * Keeps only entries that are BOTH (a) an SFV-0 dictionary item value
 * (string/number/boolean leaf) AND (b) actually SFV-0-conformant so they can
 * round-trip through serializeDictionary without throwing: a lowercase
 * SFV-conformant key, an ASCII string value, and an in-range integer. This keeps
 * the stored data, the emitted `expo-manifest-filters` header, and the
 * server-side `matchesFilters` narrowing mutually consistent.
 *
 * Returns `undefined` when the input is null/empty, not an object, or yields no
 * usable keys — `undefined` means the caller emits NO `expo-manifest-filters`
 * header, the safe default (client treats absent filters as `nil` => all updates
 * pass).
 */
export const parseManifestFiltersJson = (
  json: string | null | undefined,
): Record<string, string | number | boolean> | undefined => {
  if (!json) {
    return undefined;
  }
  const parsed = safeJsonParse(json);
  if (!isRecord(parsed)) {
    return undefined;
  }
  const usable = Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string | number | boolean] => {
      const [key, value] = entry;
      return sfvKeyRe.test(key) && isScalar(value) && isSerializableScalarValue(value);
    }),
  );
  return Object.keys(usable).length === 0 ? undefined : usable;
};

// Symmetric to parseListSafe: serializeDictionary throws SerializeError on any
// non-SFV-conformant key/value. parseManifestFiltersJson already drops those, so
// this is defense-in-depth — but it makes serializeManifestFilters TOTAL no
// matter what map it is handed, so an EMIT-side throw can never become an Effect
// defect that 500s the manifest path (anti-brick: skip the header instead).
const serializeDictionarySafe = (dict: DictionaryObject): string => {
  // eslint-disable-next-line functional/no-try-statements -- structured-headers serializeDictionary throws SerializeError on a non-SFV-conformant key/value; convert to "" so a bad stored filter degrades to NO header rather than erroring the manifest path
  try {
    return serializeDictionary(dict);
  } catch {
    return "";
  }
};

/**
 * Serialize a scalar map into an Expo SFV-0 dictionary string, e.g.
 * `key1="value1", key2=42, key3=true`.
 *
 * TOTAL: an empty record OR a map the structured-headers serializer rejects both
 * yield `""` and the caller skips the header (the safe default — client treats an
 * absent `expo-manifest-filters` as `nil` => all updates pass). It NEVER throws,
 * so it can never turn into an Effect defect that 500s the manifest path.
 */
export const serializeManifestFilters = (
  filters: Record<string, string | number | boolean>,
): string => {
  if (Object.keys(filters).length === 0) {
    return "";
  }
  return serializeDictionarySafe(filters);
};

const parseDictionarySafe = (raw: string): ReturnType<typeof parseDictionary> | undefined => {
  // eslint-disable-next-line functional/no-try-statements -- structured-headers parseDictionary throws ParseError on malformed input; convert to undefined so a bad expo-extra-params header degrades to {} rather than breaking branch routing
  try {
    return parseDictionary(raw);
  } catch {
    return undefined;
  }
};

/**
 * Parse the `expo-extra-params` SFV-0 DICTIONARY into a plain string map, e.g.
 * `cohort="beta", count=42` -> `{ cohort: "beta" }`.
 *
 * Keeps ONLY string-valued dictionary items — EAS extra-param branch routing
 * compares with string equality / in-list / regex, so integer / decimal /
 * boolean / inner-list values are dropped. TOTAL: undefined or malformed input
 * yields `{}` (never throws). This keeps the domain evaluator pure: it receives a
 * plain map and never touches structured-headers or the raw header.
 */
export const parseExtraParamsMap = (raw: string | undefined): Record<string, string> => {
  if (!raw) {
    return {};
  }
  const dict = parseDictionarySafe(raw);
  if (dict === undefined) {
    return {};
  }
  const entries = [...dict.entries()].flatMap(([key, member]): [string, string][] => {
    const [value] = member;
    return typeof value === "string" ? [[key, value]] : [];
  });
  return Object.fromEntries(entries);
};
