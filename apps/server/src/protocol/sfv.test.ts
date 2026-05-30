import { parseDictionary } from "structured-headers";

import {
  parseExtraParamsMap,
  parseManifestFiltersJson,
  parseRecentFailedUpdateIds,
  serializeManifestFilters,
} from "./sfv";

describe(serializeManifestFilters, () => {
  it("round-trips a scalar map through parseDictionary across string/int/decimal/bool", () => {
    const input = { key1: "value1", key2: 42, key3: true, key4: 3.5, key5: false };
    const serialized = serializeManifestFilters(input);
    const parsed = parseDictionary(serialized);
    const reconstructed = Object.fromEntries(
      [...parsed.entries()].map(([key, value]) => [key, value[0]]),
    );
    expect(reconstructed).toStrictEqual(input);
  });

  it("produces the expo SFV-0 dictionary wire form", () => {
    // RFC 8941 §4.1.2: a Dictionary member whose value is Boolean true is
    // serialized as the bare key (the `=?1` value is elided). false serializes
    // as `=?0`. parseDictionary reconstructs both back to the boolean.
    expect(serializeManifestFilters({ key1: "v1", key2: 42, key3: true, key4: false })).toBe(
      'key1="v1", key2=42, key3, key4=?0',
    );
  });

  it("empty record serializes to empty string (caller skips the header)", () => {
    expect(serializeManifestFilters({})).toBe("");
  });

  // P1: serializeManifestFilters must be TOTAL — a non-SFV-conformant map (which
  // parseManifestFiltersJson normally prevents, but which could be hand-built)
  // must degrade to "" (caller skips the header), NEVER throw. A throw here would
  // become an Effect defect and 500 the entire manifest path for the tenant.
  it("is total: an uppercase (non-SFV) dictionary key degrades to '' instead of throwing", () => {
    expect(serializeManifestFilters({ Channel: "prod" })).toBe("");
  });

  it("is total: a key with a space degrades to '' instead of throwing", () => {
    expect(serializeManifestFilters({ "my channel": "prod" })).toBe("");
  });

  it("is total: a non-ASCII string value degrades to '' instead of throwing", () => {
    expect(serializeManifestFilters({ channel: "café" })).toBe("");
  });

  it("is total: an out-of-range integer degrades to '' instead of throwing", () => {
    expect(serializeManifestFilters({ count: 1_000_000_000_000_000 })).toBe("");
  });
});

describe(parseRecentFailedUpdateIds, () => {
  it("parses two quoted UUIDs into a lowercased array", () => {
    const raw = '"3F2504E0-4F89-41D3-9A0C-0305E82C3301", "AABBCCDD-0000-0000-0000-000000000001"';
    expect(parseRecentFailedUpdateIds(raw)).toStrictEqual([
      "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      "aabbccdd-0000-0000-0000-000000000001",
    ]);
  });

  it("lowercases an uppercase UUID", () => {
    expect(parseRecentFailedUpdateIds('"ABC-DEF"')).toStrictEqual(["abc-def"]);
  });

  it("absent header returns []", () => {
    expect(parseRecentFailedUpdateIds(undefined)).toStrictEqual([]);
  });

  it("empty header returns []", () => {
    expect(parseRecentFailedUpdateIds("")).toStrictEqual([]);
  });

  it("malformed SFV (unterminated string) returns [] without throwing", () => {
    expect(parseRecentFailedUpdateIds('"unterminated')).toStrictEqual([]);
  });

  it("truncates to the first 5 ids", () => {
    const raw = ['"a"', '"b"', '"c"', '"d"', '"e"', '"f"', '"g"'].join(", ");
    expect(parseRecentFailedUpdateIds(raw)).toStrictEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops non-string (integer) members", () => {
    expect(parseRecentFailedUpdateIds('"a", 42, "b"')).toStrictEqual(["a", "b"]);
  });

  it("drops inner-list members", () => {
    expect(parseRecentFailedUpdateIds('"a", ("x" "y"), "b"')).toStrictEqual(["a", "b"]);
  });
});

describe(parseExtraParamsMap, () => {
  it("parses a string dictionary into a {key:value} map", () => {
    expect(parseExtraParamsMap('cohort="beta", channel="prod"')).toStrictEqual({
      cohort: "beta",
      channel: "prod",
    });
  });

  it("drops non-string item values (integer / decimal / boolean / inner-list)", () => {
    expect(
      parseExtraParamsMap('cohort="beta", count=42, ratio=1.5, flag, list=("x" "y")'),
    ).toStrictEqual({ cohort: "beta" });
  });

  it("undefined input returns {} (total)", () => {
    expect(parseExtraParamsMap(undefined)).toStrictEqual({});
  });

  it("empty string returns {} (total)", () => {
    expect(parseExtraParamsMap("")).toStrictEqual({});
  });

  it("malformed SFV (unterminated string) returns {} without throwing", () => {
    expect(parseExtraParamsMap('cohort="unterminated')).toStrictEqual({});
  });
});

describe(parseManifestFiltersJson, () => {
  it("null returns undefined", () => {
    expect(parseManifestFiltersJson(null)).toBeUndefined();
  });

  it("undefined returns undefined (absent metadata row)", () => {
    expect(parseManifestFiltersJson(undefined)).toBeUndefined();
  });

  it("empty string returns undefined", () => {
    expect(parseManifestFiltersJson("")).toBeUndefined();
  });

  it("empty object returns undefined", () => {
    expect(parseManifestFiltersJson("{}")).toBeUndefined();
  });

  it("malformed JSON returns undefined", () => {
    expect(parseManifestFiltersJson("{not json")).toBeUndefined();
  });

  it("non-object JSON returns undefined", () => {
    expect(parseManifestFiltersJson("[1, 2, 3]")).toBeUndefined();
  });

  it("keeps scalar values and drops array/object/null values", () => {
    const json = JSON.stringify({
      channel: "prod",
      count: 42,
      flag: true,
      ratio: 1.5,
      tags: ["a", "b"],
      nested: { inner: 1 },
      empty: null,
    });
    expect(parseManifestFiltersJson(json)).toStrictEqual({
      channel: "prod",
      count: 42,
      flag: true,
      ratio: 1.5,
    });
  });

  it("all-non-scalar object returns undefined (no header emitted)", () => {
    const json = JSON.stringify({ tags: ["a"], nested: { inner: 1 }, empty: null });
    expect(parseManifestFiltersJson(json)).toBeUndefined();
  });

  // P1/P3/P4: drop entries that could never round-trip through the SFV serializer
  // (non-lowercase / non-SFV keys, non-ASCII strings, out-of-range integers) so
  // the stored data, the emitted header, and the server-side narrowing stay
  // consistent — and so serializeManifestFilters never sees a throwing input.
  it("drops a non-SFV-conformant uppercase key, keeps the conformant lowercase one", () => {
    const json = JSON.stringify({ Channel: "prod", cohort: 3 });
    expect(parseManifestFiltersJson(json)).toStrictEqual({ cohort: 3 });
  });

  it("drops a key with a space", () => {
    const json = JSON.stringify({ "my channel": "prod", channel: "prod" });
    expect(parseManifestFiltersJson(json)).toStrictEqual({ channel: "prod" });
  });

  it("drops a key starting with a digit", () => {
    const json = JSON.stringify({ "1channel": "prod", channel: "prod" });
    expect(parseManifestFiltersJson(json)).toStrictEqual({ channel: "prod" });
  });

  it("drops a non-ASCII string value (e.g. café), keeps ASCII", () => {
    const json = JSON.stringify({ name: "café", channel: "prod" });
    expect(parseManifestFiltersJson(json)).toStrictEqual({ channel: "prod" });
  });

  it("drops an out-of-range integer, keeps an in-range one", () => {
    const json = JSON.stringify({ big: 1_000_000_000_000_000, cohort: 3 });
    expect(parseManifestFiltersJson(json)).toStrictEqual({ cohort: 3 });
  });

  it("keeps a fractional (decimal) number value", () => {
    const json = JSON.stringify({ ratio: 1.5 });
    expect(parseManifestFiltersJson(json)).toStrictEqual({ ratio: 1.5 });
  });

  it("an all-non-conformant object returns undefined (no header emitted)", () => {
    const json = JSON.stringify({ Channel: "prod", "my channel": "x", name: "café" });
    expect(parseManifestFiltersJson(json)).toBeUndefined();
  });

  // Defense-in-depth proof: whatever parseManifestFiltersJson admits must always
  // serialize without throwing (the P1 invariant, end to end).
  it("everything it admits round-trips through serializeManifestFilters without throwing", () => {
    // Dropped: Channel (uppercase), "my channel" (space), name (non-ASCII), big
    // (out of range). Kept: channel, cohort, ratio, beta.
    const json = JSON.stringify({
      Channel: "prod",
      "my channel": "x",
      name: "café",
      big: 1_000_000_000_000_000,
      channel: "prod",
      cohort: 3,
      ratio: 1.5,
      beta: true,
    });
    const filters = parseManifestFiltersJson(json);
    expect(filters).toStrictEqual({ channel: "prod", cohort: 3, ratio: 1.5, beta: true });
    expect(filters && serializeManifestFilters(filters)).toBe(
      'channel="prod", cohort=3, ratio=1.5, beta',
    );
  });
});
