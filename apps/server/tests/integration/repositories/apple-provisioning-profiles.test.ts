import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import {
  AppleProvisioningProfileRepo,
  AppleProvisioningProfileRepoLive,
} from "../../../src/repositories/apple-provisioning-profiles";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, AppleProvisioningProfileRepo>) =>
  runWithLayerAndEnv(effect, AppleProvisioningProfileRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, AppleProvisioningProfileRepo>) =>
  runEitherWithLayerAndEnv(effect, AppleProvisioningProfileRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, id, "2026-01-01T00:00:00Z")
    .run();

const insertAppleTeam = (id: string, orgId: string) =>
  env.DB.prepare(
    `INSERT INTO "apple_teams" ("id", "organization_id", "apple_team_id", "apple_team_type") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, orgId, `TEAM${id.toUpperCase()}`, "COMPANY_ORGANIZATION")
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("pp-org-1");
  await insertAppleTeam("pp-team-1", "pp-org-1");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("AppleProvisioningProfileRepo — D1 integration", () => {
  it("upsert inserts a new profile and returns it", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* AppleProvisioningProfileRepo;
        return yield* repo.upsert({
          id: "pp-profile-1",
          organizationId: "pp-org-1",
          appleTeamId: "pp-team-1",
          appleDistributionCertificateId: null,
          bundleIdentifier: "com.example.app",
          distributionType: "AD_HOC",
          developerPortalIdentifier: null,
          profileName: "My Profile",
          validUntil: null,
          r2Key: "r2/profiles/pp-profile-1.mobileprovision",
          isManaged: true,
          deviceRosterHash: "abc123",
        });
      }),
    );

    expect(result.model.id).toBe("pp-profile-1");
    expect(result.model.bundleIdentifier).toBe("com.example.app");
    expect(result.model.isManaged).toBe(true);
    expect(result.model.deviceRosterHash).toBe("abc123");
    expect(result.previousR2Key).toBeNull();
  });

  it("upsert updates an existing profile and returns the old r2Key when it changes", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* AppleProvisioningProfileRepo;
        return yield* repo.upsert({
          id: "pp-profile-1-new",
          organizationId: "pp-org-1",
          appleTeamId: "pp-team-1",
          appleDistributionCertificateId: null,
          bundleIdentifier: "com.example.app",
          distributionType: "AD_HOC",
          developerPortalIdentifier: null,
          profileName: "Updated Profile",
          validUntil: null,
          r2Key: "r2/profiles/pp-profile-1-updated.mobileprovision",
          isManaged: true,
          deviceRosterHash: "def456",
        });
      }),
    );

    expect(result.model.profileName).toBe("Updated Profile");
    expect(result.model.deviceRosterHash).toBe("def456");
    expect(result.previousR2Key).toBe("r2/profiles/pp-profile-1.mobileprovision");
  });

  it("list returns all profiles for an org", async () => {
    const rows = await run(
      Effect.gen(function* () {
        const repo = yield* AppleProvisioningProfileRepo;
        return yield* repo.list({ organizationId: "pp-org-1" });
      }),
    );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r) => r.organizationId === "pp-org-1")).toBe(true);
  });

  it("findById returns the profile", async () => {
    const profile = await run(
      Effect.gen(function* () {
        const repo = yield* AppleProvisioningProfileRepo;
        return yield* repo.findById({ id: "pp-profile-1" });
      }),
    );

    expect(profile.id).toBe("pp-profile-1");
    expect(profile.bundleIdentifier).toBe("com.example.app");
  });

  it("findById fails with NotFound for an unknown id", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* AppleProvisioningProfileRepo;
        return yield* repo.findById({ id: "pp-does-not-exist" });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });
});
