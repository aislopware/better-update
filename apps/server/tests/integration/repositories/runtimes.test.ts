import { env } from "cloudflare:test";
import { Effect } from "effect";

import { RuntimeRepo, RuntimeRepoLive } from "../../../src/repositories/runtimes";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, RuntimeRepo>) =>
  runWithLayerAndEnv(effect, RuntimeRepoLive, env);

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

const insertBranch = (id: string, projectId: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, projectId, `branch-${id}`, "2024-01-01T00:00:00Z")
    .run();

const insertUpdate = (id: string, branchId: string, runtimeVersion: string, createdAt: string) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "group_id", "message", "platform", "runtime_version", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, branchId, `group-${id}`, "msg", "ios", runtimeVersion, createdAt)
    .run();

const insertBuild = (
  id: string,
  projectId: string,
  runtimeVersion: string | null,
  createdAt: string,
) =>
  env.DB.prepare(
    `INSERT INTO "builds" ("id", "project_id", "platform", "distribution", "runtime_version", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, projectId, "ios", "ad-hoc", runtimeVersion, createdAt)
    .run();

const seedProject = async (suffix: string) => {
  const orgId = `org-${suffix}`;
  const projectId = `proj-${suffix}`;
  const branchId = `branch-${suffix}`;
  await insertOrg(orgId);
  await insertProject(projectId, orgId);
  await insertBranch(branchId, projectId);
  return { projectId, branchId };
};

// ── Tests ─────────────────────────────────────────────────────────

describe("RuntimeRepo — D1 integration (Kysely + session)", () => {
  test("aggregates builds and updates per runtime version, newest activity first", async () => {
    const suffix = crypto.randomUUID();
    const { projectId, branchId } = await seedProject(suffix);

    await insertBuild(`b1-${suffix}`, projectId, "1.0.0", "2024-01-02T00:00:00Z");
    await insertBuild(`b2-${suffix}`, projectId, "1.0.0", "2024-01-03T00:00:00Z");
    await insertBuild(`b3-${suffix}`, projectId, "2.0.0", "2024-01-04T00:00:00Z");
    await insertUpdate(`u1-${suffix}`, branchId, "1.0.0", "2024-01-06T00:00:00Z");
    await insertUpdate(`u2-${suffix}`, branchId, "3.0.0", "2024-01-05T00:00:00Z");

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* RuntimeRepo;
        return yield* repo.findByProject({ projectId, limit: 10, offset: 0 });
      }),
    );

    expect(result.total).toBe(3);
    expect(result.items).toEqual([
      {
        version: "1.0.0",
        buildsCount: 2,
        updatesCount: 1,
        latestActivity: "2024-01-06T00:00:00Z",
      },
      {
        version: "3.0.0",
        buildsCount: 0,
        updatesCount: 1,
        latestActivity: "2024-01-05T00:00:00Z",
      },
      {
        version: "2.0.0",
        buildsCount: 1,
        updatesCount: 0,
        latestActivity: "2024-01-04T00:00:00Z",
      },
    ]);
  });

  test("ignores builds without a runtime version and other projects' data", async () => {
    const suffix = crypto.randomUUID();
    const { projectId, branchId } = await seedProject(suffix);
    const other = await seedProject(`other-${suffix}`);

    await insertBuild(`b1-${suffix}`, projectId, null, "2024-01-02T00:00:00Z");
    await insertBuild(`b2-${suffix}`, other.projectId, "9.9.9", "2024-01-02T00:00:00Z");
    await insertUpdate(`u1-${suffix}`, other.branchId, "9.9.9", "2024-01-02T00:00:00Z");
    await insertUpdate(`u2-${suffix}`, branchId, "1.0.0", "2024-01-03T00:00:00Z");

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* RuntimeRepo;
        return yield* repo.findByProject({ projectId, limit: 10, offset: 0 });
      }),
    );

    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      {
        version: "1.0.0",
        buildsCount: 0,
        updatesCount: 1,
        latestActivity: "2024-01-03T00:00:00Z",
      },
    ]);
  });

  test("paginates with total reflecting all versions", async () => {
    const suffix = crypto.randomUUID();
    const { branchId, projectId } = await seedProject(suffix);

    await insertUpdate(`u1-${suffix}`, branchId, "1.0.0", "2024-01-01T00:00:00Z");
    await insertUpdate(`u2-${suffix}`, branchId, "2.0.0", "2024-01-02T00:00:00Z");
    await insertUpdate(`u3-${suffix}`, branchId, "3.0.0", "2024-01-03T00:00:00Z");

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* RuntimeRepo;
        return yield* repo.findByProject({ projectId, limit: 2, offset: 2 });
      }),
    );

    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.version).toBe("1.0.0");
  });
});
