import { isCanonicalSelector } from "@better-update/api";

// Pins the shared selector-vocabulary validator that the server enforces at
// policy-write time (handlers/policies.ts) so a pluralised/typo'd selector is
// rejected instead of being stored as a silently inert policy.
describe(isCanonicalSelector, () => {
  it("accepts canonical resource paths and wildcards", () => {
    const canonical = [
      "*",
      "org",
      "project/A",
      "project/*",
      "project/A/build",
      "project/A/build/b1",
      "project/A/credential",
      "project/A/submission/s1",
      "project/A/env/production",
      "project/*/env/production",
      "project/A/env/preview/envVar",
      "project/A/env/preview/envVar/API_URL",
      "project/A/channel/X",
      "project/A/channel/*/update",
      "project/A/channel/X/update/u1",
      "project/A/channel/X/rollout",
      "project/A/*",
    ];
    for (const selector of canonical) {
      expect(isCanonicalSelector(selector)).toBe(true);
    }
  });

  it("rejects pluralised, mistyped, shallow, or over-deep selectors", () => {
    const inert = [
      "project/A/channels/X",
      "project/A/environment/production",
      "project/A/channel/X/updates/1",
      "project",
      "project/A/bogus",
      "org/extra",
      "project/A/channel/X/update/u1/extra",
    ];
    for (const selector of inert) {
      expect(isCanonicalSelector(selector)).toBe(false);
    }
  });
});
