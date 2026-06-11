import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { buildBranchMapping } from "../../../src/domain/branch-mapping";
import { BranchRepo, BranchRepoLive } from "../../../src/repositories/branches";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, BranchRepo>) =>
  runWithLayerAndEnv(effect, BranchRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, BranchRepo>) =>
  runEitherWithLayerAndEnv(effect, BranchRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2024-01-01T00:00:00Z")
    .run();

const insertProject = (id: string, organizationId: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `Project ${id}`, `test-${id}`, "2024-01-01T00:00:00Z")
    .run();

const insertBranch = (id: string, projectId: string, name: string, createdAt: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, projectId, name, createdAt)
    .run();

const insertUpdate = (id: string, branchId: string) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "group_id", "message", "platform", "runtime_version", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, branchId, `group-${id}`, "msg", "ios", "1.0.0", "2024-01-05T00:00:00Z")
    .run();

const insertUpdateAsset = async (updateId: string, assetKey: string) => {
  // `update_assets.asset_hash` FKs `assets.hash` (NOT NULL) — seed the asset first.
  const assetHash = `hash-${assetKey}`;
  await env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      assetHash,
      "application/octet-stream",
      "bin",
      1,
      `r2/${assetHash}`,
      "2024-01-04T00:00:00Z",
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash") VALUES (?, ?, ?)`,
  )
    .bind(updateId, assetKey, assetHash)
    .run();
};

const insertChannel = (params: {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly branchId: string;
  readonly branchMappingJson?: string | null;
}) =>
  env.DB.prepare(
    `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      params.name,
      params.branchId,
      params.branchMappingJson ?? null,
      "2024-01-03T00:00:00Z",
    )
    .run();

const countRows = async (table: string, column: string, value: string) => {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE "${column}" = ?`)
    .bind(value)
    .first<{ count: number }>();
  return row?.count ?? 0;
};

// ── Tests ─────────────────────────────────────────────────────────

describe("BranchRepo — D1 integration (Kysely + session)", () => {
  test("findByProject returns items with computed update_count, sorted", async () => {
    const suffix = crypto.randomUUID();
    const orgId = `org-${suffix}`;
    const projectId = `proj-${suffix}`;
    const prodId = `branch-prod-${suffix}`;
    const stagingId = `branch-staging-${suffix}`;

    await insertOrg(orgId);
    await insertProject(projectId, orgId);
    await insertBranch(prodId, projectId, "production", "2024-01-02T00:00:00Z");
    await insertBranch(stagingId, projectId, "staging", "2024-01-04T00:00:00Z");
    await insertUpdate(`upd-1-${suffix}`, prodId);
    await insertUpdate(`upd-2-${suffix}`, prodId);

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        return yield* repo.findByProject({
          projectId,
          sort: "updateCount",
          order: "desc",
          limit: 20,
          offset: 0,
        });
      }),
    );

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      id: prodId,
      projectId,
      name: "production",
      isBuiltin: false,
      createdAt: "2024-01-02T00:00:00Z",
      updateCount: 2,
    });
    expect(result.items[1]?.name).toBe("staging");
    expect(result.items[1]?.updateCount).toBe(0);
  });

  describe("findByProject query search (LIKE)", () => {
    const seedSearchBranches = async () => {
      const suffix = crypto.randomUUID();
      const orgId = `org-${suffix}`;
      const projectId = `proj-${suffix}`;

      await insertOrg(orgId);
      await insertProject(projectId, orgId);
      await insertBranch(`branch-prod-${suffix}`, projectId, "Production", "2024-01-02T00:00:00Z");
      await insertBranch(
        `branch-preview-${suffix}`,
        projectId,
        "preview-feature",
        "2024-01-03T00:00:00Z",
      );
      await insertBranch(`branch-dev-${suffix}`, projectId, "development", "2024-01-04T00:00:00Z");

      return { suffix, projectId };
    };

    const findWithQuery = (projectId: string, query: string, limit = 20) =>
      run(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          return yield* repo.findByProject({
            projectId,
            query,
            sort: "createdAt",
            order: "asc",
            limit,
            offset: 0,
          });
        }),
      );

    test("matches name substring case-insensitively", async () => {
      const { projectId } = await seedSearchBranches();

      const result = await findWithQuery(projectId, "PROD");

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.name).toBe("Production");
    });

    test("total respects the filter when the page is smaller than the match set", async () => {
      const { projectId } = await seedSearchBranches();

      // "ev" matches both "preview-feature" and "development".
      const result = await findWithQuery(projectId, "ev", 1);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.name).toBe("preview-feature");
    });

    test("returns empty when no branch matches", async () => {
      const { projectId } = await seedSearchBranches();

      const result = await findWithQuery(projectId, "doesnotexist");

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  test("findById returns NotFound when the branch is absent", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        return yield* repo.findById({ id: `missing-${crypto.randomUUID()}` });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound" });
    }
  });

  test("insert succeeds then rejects a duplicate name with Conflict", async () => {
    const suffix = crypto.randomUUID();
    const orgId = `org-${suffix}`;
    const projectId = `proj-${suffix}`;

    await insertOrg(orgId);
    await insertProject(projectId, orgId);

    await run(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.insert({
          id: `branch-a-${suffix}`,
          projectId,
          name: "production",
          isBuiltin: false,
          createdAt: "2024-01-02T00:00:00Z",
        });
      }),
    );

    const inserted = await run(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        return yield* repo.findByProjectAndName({ projectId, name: "production" });
      }),
    );
    expect(inserted.id).toBe(`branch-a-${suffix}`);

    const conflict = await runEither(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.insert({
          id: `branch-b-${suffix}`,
          projectId,
          name: "production",
          isBuiltin: false,
          createdAt: "2024-01-03T00:00:00Z",
        });
      }),
    );

    expect(Either.isLeft(conflict)).toBe(true);
    if (Either.isLeft(conflict)) {
      expect(conflict.left).toMatchObject({ _tag: "Conflict" });
    }
  });

  test("updateName renames the branch", async () => {
    const suffix = crypto.randomUUID();
    const orgId = `org-${suffix}`;
    const projectId = `proj-${suffix}`;
    const branchId = `branch-${suffix}`;

    await insertOrg(orgId);
    await insertProject(projectId, orgId);
    await insertBranch(branchId, projectId, "old-name", "2024-01-02T00:00:00Z");

    await run(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.updateName({ id: branchId, name: "new-name" });
      }),
    );

    const row = await env.DB.prepare(`SELECT "name" FROM "branches" WHERE "id" = ?`)
      .bind(branchId)
      .first<{ name: string }>();
    expect(row).toEqual({ name: "new-name" });
  });

  test("delete cascades updates and update_assets when no channel references the branch", async () => {
    const suffix = crypto.randomUUID();
    const orgId = `org-${suffix}`;
    const projectId = `proj-${suffix}`;
    const branchId = `branch-${suffix}`;
    const updateId = `upd-${suffix}`;

    await insertOrg(orgId);
    await insertProject(projectId, orgId);
    await insertBranch(branchId, projectId, "doomed", "2024-01-02T00:00:00Z");
    await insertUpdate(updateId, branchId);
    await insertUpdateAsset(updateId, `asset-${suffix}`);

    await run(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.delete({ id: branchId });
      }),
    );

    expect(await countRows("branches", "id", branchId)).toBe(0);
    expect(await countRows("updates", "branch_id", branchId)).toBe(0);
    expect(await countRows("update_assets", "update_id", updateId)).toBe(0);
  });

  test("delete fails with Conflict when a channel rollout-mapping targets the branch", async () => {
    const suffix = crypto.randomUUID();
    const orgId = `org-${suffix}`;
    const projectId = `proj-${suffix}`;
    const mainBranchId = `branch-main-${suffix}`;
    const rolloutBranchId = `branch-rollout-${suffix}`;

    await insertOrg(orgId);
    await insertProject(projectId, orgId);
    await insertBranch(mainBranchId, projectId, "main", "2024-01-02T00:00:00Z");
    await insertBranch(rolloutBranchId, projectId, "rollout", "2024-01-03T00:00:00Z");
    await insertChannel({
      id: `channel-${suffix}`,
      projectId,
      name: "production",
      branchId: mainBranchId,
      branchMappingJson: buildBranchMapping({
        newBranchId: rolloutBranchId,
        oldBranchId: mainBranchId,
        percentage: 25,
        salt: `salt-${suffix}`,
      }),
    });

    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* BranchRepo;
        yield* repo.delete({ id: rolloutBranchId });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "Conflict" });
    }
    // The branch survived the rejected delete.
    expect(await countRows("branches", "id", rolloutBranchId)).toBe(1);
  });
});
