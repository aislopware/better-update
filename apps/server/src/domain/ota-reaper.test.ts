import { isPatchReapEligible } from "./ota-reaper";

import type { ParsedPatchKey } from "../lib/patch-key";

const CUTOFF = "2026-05-01T00:00:00.000Z";
// BEFORE is beyond the TTL (older than cutoff); AFTER is within the TTL.
const BEFORE = "2026-04-01T00:00:00.000Z";
const AFTER = "2026-05-15T00:00:00.000Z";

const parsed: ParsedPatchKey = {
  projectId: "p",
  runtimeVersion: "1.0.0",
  platform: "ios",
  fromUpdateId: "from",
  toUpdateId: "to",
};

const base = {
  parsed,
  toSurvives: true,
  fromSurvives: true,
  fromIsValidBase: true,
  cutoff: CUTOFF,
};

describe(isPatchReapEligible, () => {
  it("keeps a live patch: valid base + surviving target + within TTL", () => {
    expect(isPatchReapEligible({ ...base, uploadedAt: AFTER })).toBe(false);
  });

  it("keeps a live patch even beyond TTL when base + target both still reachable", () => {
    expect(isPatchReapEligible({ ...base, uploadedAt: BEFORE })).toBe(false);
  });

  it("reaps when the target no longer survives and beyond TTL", () => {
    expect(isPatchReapEligible({ ...base, uploadedAt: BEFORE, toSurvives: false })).toBe(true);
  });

  it("reaps when the from id no longer survives and beyond TTL", () => {
    expect(isPatchReapEligible({ ...base, uploadedAt: BEFORE, fromSurvives: false })).toBe(true);
  });

  it("reaps when the from id is no longer a valid base and beyond TTL", () => {
    expect(isPatchReapEligible({ ...base, uploadedAt: BEFORE, fromIsValidBase: false })).toBe(true);
  });

  it("reaps a malformed key beyond TTL", () => {
    expect(
      isPatchReapEligible({
        parsed: null,
        toSurvives: false,
        fromSurvives: false,
        fromIsValidBase: false,
        cutoff: CUTOFF,
        uploadedAt: BEFORE,
      }),
    ).toBe(true);
  });

  it("keeps everything within TTL regardless of cross-ref (TTL gate first)", () => {
    expect(
      isPatchReapEligible({
        ...base,
        uploadedAt: AFTER,
        toSurvives: false,
        fromSurvives: false,
        fromIsValidBase: false,
      }),
    ).toBe(false);
  });

  it("keeps a malformed key still within TTL", () => {
    expect(
      isPatchReapEligible({
        parsed: null,
        toSurvives: false,
        fromSurvives: false,
        fromIsValidBase: false,
        cutoff: CUTOFF,
        uploadedAt: AFTER,
      }),
    ).toBe(false);
  });

  it("treats uploadedAt exactly at the cutoff as within TTL (kept)", () => {
    expect(isPatchReapEligible({ ...base, uploadedAt: CUTOFF, toSurvives: false })).toBe(false);
  });
});
