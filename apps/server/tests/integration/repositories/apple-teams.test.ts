import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { AppleTeamRepo, AppleTeamRepoLive } from "../../../src/repositories/apple-teams";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, AppleTeamRepo>) =>
  runWithLayerAndEnv(effect, AppleTeamRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, AppleTeamRepo>) =>
  runEitherWithLayerAndEnv(effect, AppleTeamRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, id, "2026-01-01T00:00:00Z")
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("org-at-1");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("AppleTeamRepo — D1 integration (Kysely + session)", () => {
  it("upserts a new team on insert and returns the model", async () => {
    const model = await run(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.upsertByAppleTeamId({
          organizationId: "org-at-1",
          appleTeamId: "TEAM0000001",
          appleTeamType: "COMPANY_ORGANIZATION",
          name: "Acme Corp",
        });
      }),
    );

    expect(model.organizationId).toBe("org-at-1");
    expect(model.appleTeamId).toBe("TEAM0000001");
    expect(model.appleTeamType).toBe("COMPANY_ORGANIZATION");
    expect(model.name).toBe("Acme Corp");
    expect(typeof model.id).toBe("string");
  });

  it("updates type and preserves name when upserted with null name", async () => {
    // First insert gives the team a name
    await run(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.upsertByAppleTeamId({
          organizationId: "org-at-1",
          appleTeamId: "TEAM0000002",
          appleTeamType: "INDIVIDUAL",
          name: "Original Name",
        });
      }),
    );

    // Second upsert with null name: type should change, name should be preserved
    const updated = await run(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.upsertByAppleTeamId({
          organizationId: "org-at-1",
          appleTeamId: "TEAM0000002",
          appleTeamType: "COMPANY_ORGANIZATION",
          name: null,
        });
      }),
    );

    expect(updated.appleTeamType).toBe("COMPANY_ORGANIZATION");
    expect(updated.name).toBe("Original Name");
  });

  it("findById returns the team when it exists", async () => {
    const inserted = await run(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.upsertByAppleTeamId({
          organizationId: "org-at-1",
          appleTeamId: "TEAM0000003",
          appleTeamType: "IN_HOUSE",
          name: "Find Me",
        });
      }),
    );

    const found = await run(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.findById({ id: inserted.id });
      }),
    );

    expect(found.id).toBe(inserted.id);
    expect(found.name).toBe("Find Me");
  });

  it("findById fails with NotFound for an unknown id", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.findById({ id: "00000000-0000-0000-0000-000000000000" });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("listWithCounts returns teams with zero counts when no credentials exist", async () => {
    const teams = await run(
      Effect.gen(function* () {
        const repo = yield* AppleTeamRepo;
        return yield* repo.listWithCounts({ organizationId: "org-at-1" });
      }),
    );

    expect(teams.length).toBeGreaterThan(0);
    for (const team of teams) {
      expect(team.distributionCertificateCount).toBe(0);
      expect(team.pushKeyCount).toBe(0);
      expect(team.ascApiKeyCount).toBe(0);
      expect(team.provisioningProfileCount).toBe(0);
      expect(team.deviceCount).toBe(0);
    }
  });
});
