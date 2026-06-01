import { matchesFilters, skipFailedUpdates } from "./manifest-filters";

describe(matchesFilters, () => {
  it("undefined filters -> true", () => {
    expect(matchesFilters({ channel: "prod" }, undefined)).toBe(true);
  });

  it("undefined metadata -> true", () => {
    expect(matchesFilters(undefined, { channel: "prod" })).toBe(true);
  });

  it("filter key absent in metadata -> true (no constraint)", () => {
    expect(matchesFilters({ other: "x" }, { channel: "prod" })).toBe(true);
  });

  it("key present and equal -> true", () => {
    expect(matchesFilters({ channel: "prod" }, { channel: "prod" })).toBe(true);
  });

  it("key present and differs -> false", () => {
    expect(matchesFilters({ channel: "staging" }, { channel: "prod" })).toBe(false);
  });

  it("matches metadata keys case-insensitively against a (lowercase) filter key", () => {
    // The filter key is used VERBATIM (mirroring the device's SelectionPolicies,
    // which only lowercases metadata keys), while metadata keys are lowercased.
    // So a lowercase filter key matches differently-cased metadata keys.
    expect(matchesFilters({ Channel: "prod" }, { channel: "prod" })).toBe(true);
    expect(matchesFilters({ CHANNEL: "staging" }, { channel: "prod" })).toBe(false);
  });

  it("does NOT lowercase the filter key (non-lowercase filter key is absent in metadata -> passes)", () => {
    // parseManifestFiltersJson normalizes stored keys to lowercase, so a
    // non-lowercase filter key can never reach matchesFilters in production. But
    // the contract is explicit: the filter key is verbatim — `Channel` is not the
    // same constraint as `channel`, so it imposes none on metadata.channel.
    expect(matchesFilters({ channel: "staging" }, { Channel: "prod" })).toBe(true);
  });

  it("string value equality (filter values are string-only)", () => {
    // Filter values are string-only (see parseManifestFiltersJson): a numeric or
    // boolean condition is expressed as the string "3" / "true" on BOTH the
    // metadata and the filter side, matching how the device compares them.
    expect(matchesFilters({ cohort: "3" }, { cohort: "3" })).toBe(true);
    expect(matchesFilters({ cohort: "4" }, { cohort: "3" })).toBe(false);
    expect(matchesFilters({ beta: "true" }, { beta: "true" })).toBe(true);
    expect(matchesFilters({ beta: "false" }, { beta: "true" })).toBe(false);
  });

  it("multiple keys where exactly one differs -> false", () => {
    expect(matchesFilters({ channel: "prod", cohort: "3" }, { channel: "prod", cohort: "4" })).toBe(
      false,
    );
  });

  it("multiple keys all matching -> true", () => {
    expect(matchesFilters({ channel: "prod", cohort: "3" }, { channel: "prod", cohort: "3" })).toBe(
      true,
    );
  });

  it("strict equality: metadata number vs string filter does not match", () => {
    // metadata is free-form JSON (Record<string,unknown>); a numeric metadata
    // value never equals the string filter value the client actually compares.
    expect(matchesFilters({ cohort: 3 }, { cohort: "3" })).toBe(false);
  });
});

describe(skipFailedUpdates, () => {
  const mk = (id: string) => ({ id });

  it("removes a candidate whose id is in failedIds", () => {
    expect(skipFailedUpdates([mk("a"), mk("b"), mk("c")], ["b"])).toStrictEqual([mk("a"), mk("c")]);
  });

  it("preserves order of survivors", () => {
    expect(skipFailedUpdates([mk("a"), mk("b"), mk("c"), mk("d")], ["b", "d"])).toStrictEqual([
      mk("a"),
      mk("c"),
    ]);
  });

  it("empty failedIds -> returns the same array (identity)", () => {
    const candidates = [mk("a"), mk("b")];
    expect(skipFailedUpdates(candidates, [])).toBe(candidates);
  });

  it("failedId not present among candidates -> unchanged", () => {
    expect(skipFailedUpdates([mk("a"), mk("b")], ["zzz"])).toStrictEqual([mk("a"), mk("b")]);
  });

  it("NEVER-STRAND: every candidate id present in failedIds -> [] (no throw)", () => {
    expect(skipFailedUpdates([mk("a"), mk("b")], ["a", "b"])).toStrictEqual([]);
  });
});
