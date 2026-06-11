import { env } from "cloudflare:test";
import { Effect } from "effect";

import { buildBranchMapping } from "../../../src/domain/branch-mapping";
import { ChannelRepo, ChannelRepoLive } from "../../../src/repositories/channels";
import { runWithLayerAndEnv } from "../../helpers/runtime";

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ChannelRepo>) =>
  runWithLayerAndEnv(effect, ChannelRepoLive, env);

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

const insertBranch = (id: string, projectId: string, name: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, projectId, name, "2024-01-02T00:00:00Z")
    .run();

const insertChannel = (params: {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly branchId: string;
  readonly branchMappingJson?: string | null;
  readonly cacheVersion?: number;
}) =>
  env.DB.prepare(
    `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      params.name,
      params.branchId,
      params.branchMappingJson ?? null,
      params.cacheVersion ?? 0,
      0,
      "2024-01-03T00:00:00Z",
    )
    .run();

describe("ChannelRepo -- findByProject query search (LIKE)", () => {
  const seedSearchChannels = async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-search-${suffix}`;
    const projectId = `proj-search-${suffix}`;
    const branchId = `branch-main-${suffix}`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(branchId, projectId, "main");
    await insertChannel({ id: `channel-prod-${suffix}`, projectId, name: "Production", branchId });
    await insertChannel({
      id: `channel-preview-${suffix}`,
      projectId,
      name: "preview-feature",
      branchId,
    });
    await insertChannel({ id: `channel-dev-${suffix}`, projectId, name: "development", branchId });

    return { suffix, projectId };
  };

  const findWithQuery = (projectId: string, query: string, limit = 20) =>
    run(
      Effect.gen(function* () {
        const repo = yield* ChannelRepo;
        return yield* repo.findByProject({
          projectId,
          query,
          sort: "name",
          order: "asc",
          limit,
          offset: 0,
        });
      }),
    );

  test("matches name substring case-insensitively", async () => {
    const { projectId } = await seedSearchChannels();

    const result = await findWithQuery(projectId, "PROD");

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe("Production");
  });

  test("total respects the filter when the page is smaller than the match set", async () => {
    const { projectId } = await seedSearchChannels();

    // "ev" matches both "preview-feature" and "development".
    const result = await findWithQuery(projectId, "ev", 1);

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe("development");
  });

  test("returns empty when no channel matches", async () => {
    const { projectId } = await seedSearchChannels();

    const result = await findWithQuery(projectId, "doesnotexist");

    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

describe("ChannelRepo -- cache version integration", () => {
  test("bumps cache version for direct channels and rollout target channels", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-channel-${suffix}`;
    const projectId = `proj-channel-${suffix}`;
    const mainBranchId = `branch-main-${suffix}`;
    const rolloutBranchId = `branch-1-${suffix}`;
    const similarBranchId = `${rolloutBranchId}0`;

    await insertOrg(organizationId);
    await insertProject(projectId, organizationId);
    await insertBranch(mainBranchId, projectId, "main");
    await insertBranch(rolloutBranchId, projectId, "rollout");
    await insertBranch(similarBranchId, projectId, "rollout-similar");
    await insertChannel({
      id: `channel-direct-${suffix}`,
      projectId,
      name: "direct",
      branchId: rolloutBranchId,
      cacheVersion: 3,
    });
    await insertChannel({
      id: `channel-rollout-${suffix}`,
      projectId,
      name: "rollout",
      branchId: mainBranchId,
      branchMappingJson: buildBranchMapping({
        newBranchId: rolloutBranchId,
        oldBranchId: mainBranchId,
        percentage: 25,
        salt: `salt-${suffix}`,
      }),
      cacheVersion: 7,
    });
    await insertChannel({
      id: `channel-rollout-similar-${suffix}`,
      projectId,
      name: "rollout-similar",
      branchId: mainBranchId,
      branchMappingJson: buildBranchMapping({
        newBranchId: similarBranchId,
        oldBranchId: mainBranchId,
        percentage: 25,
        salt: `salt-similar-${suffix}`,
      }),
      cacheVersion: 11,
    });

    await run(
      Effect.gen(function* () {
        const repo = yield* ChannelRepo;
        yield* repo.bumpCacheVersionByBranch({ branchId: rolloutBranchId });
      }),
    );

    const rows = await env.DB.prepare(
      `SELECT "name", "cache_version" FROM "channels" WHERE "project_id" = ? ORDER BY "name" ASC`,
    )
      .bind(projectId)
      .all<{ name: string; cache_version: number }>();

    expect(rows.results).toEqual([
      { name: "direct", cache_version: 4 },
      { name: "rollout", cache_version: 8 },
      { name: "rollout-similar", cache_version: 11 },
    ]);
  });
});
