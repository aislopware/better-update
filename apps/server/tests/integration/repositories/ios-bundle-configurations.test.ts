import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import {
  IosBundleConfigurationRepo,
  IosBundleConfigurationRepoLive,
} from "../../../src/repositories/ios-bundle-configurations";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, IosBundleConfigurationRepo>) =>
  runWithLayerAndEnv(effect, IosBundleConfigurationRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, IosBundleConfigurationRepo>) =>
  runEitherWithLayerAndEnv(effect, IosBundleConfigurationRepoLive, env);

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

const insertProject = (id: string, orgId: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, `Project ${id}`, id, "2026-01-01T00:00:00Z")
    .run();

const seedConfig = (
  id: string,
  projectId: string,
  orgId: string,
  teamId: string,
  bundleId: string,
  distributionType: string,
) =>
  env.DB.prepare(
    `INSERT INTO "ios_bundle_configurations"
      ("id", "organization_id", "project_id", "bundle_identifier", "distribution_type",
       "apple_team_id", "created_at", "updated_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      projectId,
      bundleId,
      distributionType,
      teamId,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    )
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("ibc-org-1");
  await insertAppleTeam("ibc-team-1", "ibc-org-1");
  await insertProject("ibc-proj-1", "ibc-org-1");
  await seedConfig(
    "ibc-cfg-1",
    "ibc-proj-1",
    "ibc-org-1",
    "ibc-team-1",
    "com.example.app",
    "APP_STORE",
  );
  await seedConfig(
    "ibc-cfg-2",
    "ibc-proj-1",
    "ibc-org-1",
    "ibc-team-1",
    "com.example.app",
    "AD_HOC",
  );
});

// ── Tests ─────────────────────────────────────────────────────────

describe("IosBundleConfigurationRepo — D1 integration (Kysely)", () => {
  it("listByProject returns configs ordered by bundle_identifier then distribution_type", async () => {
    const configs = await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.listByProject({ projectId: "ibc-proj-1" });
      }),
    );

    expect(configs).toHaveLength(2);
    // AD_HOC < APP_STORE alphabetically
    expect(configs[0].id).toBe("ibc-cfg-2");
    expect(configs[0].distributionType).toBe("AD_HOC");
    expect(configs[1].id).toBe("ibc-cfg-1");
    expect(configs[1].distributionType).toBe("APP_STORE");
  });

  it("findByProjectAndBundle returns config and fails NotFound for missing", async () => {
    const config = await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.findByProjectAndBundle({
          projectId: "ibc-proj-1",
          bundleIdentifier: "com.example.app",
          distributionType: "APP_STORE",
        });
      }),
    );

    expect(config.id).toBe("ibc-cfg-1");
    expect(config.bundleIdentifier).toBe("com.example.app");
    expect(config.organizationId).toBe("ibc-org-1");

    const missing = await runEither(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.findByProjectAndBundle({
          projectId: "ibc-proj-1",
          bundleIdentifier: "com.example.app",
          distributionType: "ENTERPRISE",
        });
      }),
    );

    expect(Either.isLeft(missing)).toBe(true);
    if (Either.isLeft(missing)) {
      expect(missing.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("findById returns config and fails NotFound for missing id", async () => {
    const config = await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.findById({ id: "ibc-cfg-2" });
      }),
    );

    expect(config.id).toBe("ibc-cfg-2");
    expect(config.distributionType).toBe("AD_HOC");

    const missing = await runEither(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.findById({ id: "ibc-cfg-missing" });
      }),
    );

    expect(Either.isLeft(missing)).toBe(true);
    if (Either.isLeft(missing)) {
      expect(missing.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  it("insert adds a config and fails Conflict on duplicate project+bundle+distribution_type", async () => {
    const params = {
      id: "ibc-cfg-3",
      organizationId: "ibc-org-1",
      projectId: "ibc-proj-1",
      bundleIdentifier: "com.example.new",
      distributionType: "APP_STORE" as const,
      appleTeamId: "ibc-team-1",
      appleDistributionCertificateId: null,
      appleProvisioningProfileId: null,
      applePushKeyId: null,
      ascApiKeyId: null,
      targetName: null,
      parentBundleIdentifier: null,
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
    };

    await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.insert(params);
      }),
    );

    // Verify row exists
    const row = await env.DB.prepare(
      `SELECT "bundle_identifier" FROM "ios_bundle_configurations" WHERE "id" = ?`,
    )
      .bind("ibc-cfg-3")
      .first<{ bundle_identifier: string }>();
    expect(row?.bundle_identifier).toBe("com.example.new");

    // Duplicate → Conflict
    const conflict = await runEither(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.insert({ ...params, id: "ibc-cfg-4" });
      }),
    );

    expect(Either.isLeft(conflict)).toBe(true);
    if (Either.isLeft(conflict)) {
      expect(conflict.left).toMatchObject({ _tag: "Conflict" });
    }
  });

  it("update patches nullable fields and delete removes the row", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.update({
          id: "ibc-cfg-1",
          targetName: "MyTarget",
          updatedAt: "2026-03-01T00:00:00Z",
        });
      }),
    );

    const updated = await env.DB.prepare(
      `SELECT "target_name", "updated_at" FROM "ios_bundle_configurations" WHERE "id" = ?`,
    )
      .bind("ibc-cfg-1")
      .first<{ target_name: string; updated_at: string }>();
    expect(updated?.target_name).toBe("MyTarget");
    expect(updated?.updated_at).toBe("2026-03-01T00:00:00Z");

    // Nullify the field
    await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.update({
          id: "ibc-cfg-1",
          targetName: null,
          updatedAt: "2026-03-02T00:00:00Z",
        });
      }),
    );

    const nulled = await env.DB.prepare(
      `SELECT "target_name" FROM "ios_bundle_configurations" WHERE "id" = ?`,
    )
      .bind("ibc-cfg-1")
      .first<{ target_name: string | null }>();
    expect(nulled?.target_name).toBeNull();

    // Delete
    await run(
      Effect.gen(function* () {
        const repo = yield* IosBundleConfigurationRepo;
        return yield* repo.delete({ id: "ibc-cfg-1" });
      }),
    );

    const gone = await env.DB.prepare(`SELECT "id" FROM "ios_bundle_configurations" WHERE "id" = ?`)
      .bind("ibc-cfg-1")
      .first();
    expect(gone).toBeNull();
  });
});
