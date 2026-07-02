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
      "project/A/env/preview/channel/X",
      "project/A/env/*/channel/*/update",
      "project/A/env/production/channel/X/update/u1",
      "project/A/env/production/channel/X/rollout",
      "project/A/*",
      // Apple-team axis (authz-models.ts): team-scoped credential grants.
      "appleTeam/JMANGO1234",
      "appleTeam/*",
      "appleTeam/JMANGO1234/credential",
      "appleTeam/JMANGO1234/credential/c1",
      "appleTeam/none/credential",
    ];
    for (const selector of canonical) {
      expect(isCanonicalSelector(selector)).toBe(true);
    }
  });

  it("rejects pluralised, mistyped, shallow, or over-deep selectors", () => {
    const inert = [
      "project/A/channels/X",
      "project/A/environment/production",
      "project/A/env/preview/channel/X/updates/1",
      "project",
      "project/A/bogus",
      "org/extra",
      // The channel axis lives under env/{environment} now (SPEC §2d) — the old
      // env-less channel paths are no longer produced by resolvePath.
      "project/A/channel/X",
      "project/A/channel/X/update/u1",
      "project/A/env/preview/channel/X/update/u1/extra",
      // Bare axis heads stay non-canonical (match nothing deeper on their own
      // at write time) — grant org-wide Apple access via `appleTeam/*`.
      "appleTeam",
      "appleTeam/JMANGO1234/credentials",
      "appleTeam/JMANGO1234/credential/c1/extra",
    ];
    for (const selector of inert) {
      expect(isCanonicalSelector(selector)).toBe(false);
    }
  });
});
