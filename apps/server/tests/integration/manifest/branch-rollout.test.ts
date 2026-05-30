import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../../src";

// RTV-constrained branch-rollout routing + manifest-cache isolation, dispatched
// straight into worker.fetch (full route + branch-mapping evaluator + repo +
// Cache API) against local D1 via @cloudflare/vitest-pool-workers.
//
// A single channel carries an RTV-constrained branch mapping:
//   ["and", {runtimeVersion == RTV_A}, {rolloutToken hash_lt 1.00}]  -> branch X
//   "true"                                                            -> branch Y (default)
// So RTV_A clients route to branch X and any other RTV (RTV_B) falls through to
// branch Y. Branch X has an RTV_A update; branch Y has an RTV_B update — both at
// 100% rollout (cacheable). Because the manifest cache key includes BOTH
// runtimeVersion and resolvedBranchId, RTV_A's cached manifest must never be
// served to an RTV_B request and vice versa.

const BASE = "http://localhost";
const RTV_A = "1.0.0";
const RTV_B = "2.0.0";
const FIXED_CLIENT_ID = "fixed-client-uuid";

const fetchManifest = async (
  projectId: string,
  runtimeVersion: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE}/manifest/${projectId}`, {
      headers: {
        "expo-protocol-version": "1",
        "expo-platform": "ios",
        "expo-runtime-version": runtimeVersion,
        "expo-channel-name": "production",
        "eas-client-id": FIXED_CLIENT_ID,
        accept: "multipart/mixed",
        ...extraHeaders,
      },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
};

const manifestIdOf = async (response: Response): Promise<string> => {
  const text = await response.text();
  const match = /"id"\s*:\s*"([^"]+)"/u.exec(text);
  return match?.[1] ?? "";
};

const manifestBody = (updateId: string, runtimeVersion: string) =>
  JSON.stringify({
    id: updateId,
    createdAt: "2026-01-01T00:00:00.000Z",
    runtimeVersion,
    launchAsset: { key: "bundle", contentType: "application/javascript", url: `${BASE}/x` },
    assets: [],
    metadata: {},
    extra: {},
  });

const seedUpdate = async (params: {
  updateId: string;
  branchId: string;
  runtimeVersion: string;
}) => {
  await env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at") VALUES (?, ?, ?, 'ios', 'm', '{}', ?, 100, 0, ?, '2026-01-01T00:00:00.000Z')`,
  )
    .bind(
      params.updateId,
      params.branchId,
      params.runtimeVersion,
      `group-${params.updateId}`,
      manifestBody(params.updateId, params.runtimeVersion),
    )
    .run();
};

describe("manifest serving — RTV-constrained branch rollout routing + cache isolation", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `rtv-rollout-${suffix}`;
  const orgId = `org-${projectId}`;
  const branchX = `branch-x-${suffix}`;
  const branchY = `branch-y-${suffix}`;
  const updateX = `aaaa1111-${suffix}`;
  const updateY = `bbbb2222-${suffix}`;

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'RTV Org', ?, '2026-01-01T00:00:00Z')`,
    )
      .bind(orgId, orgId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "scope_key", "created_at") VALUES (?, ?, 'RTV Project', ?, ?, '2026-01-01T00:00:00Z')`,
    )
      .bind(projectId, orgId, `slug-${projectId}`, `https://rtv-${suffix}.example`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'x', '2026-01-01T00:00:00Z')`,
    )
      .bind(branchX, projectId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'y', '2026-01-01T00:00:00Z')`,
    )
      .bind(branchY, projectId)
      .run();

    // RTV-constrained mapping: RTV_A clients (100% bucket) -> branch X; everyone
    // else falls through to the 'true' default -> branch Y.
    const branchMappingJson = JSON.stringify({
      data: [
        {
          branchId: branchX,
          branchMappingLogic: [
            "and",
            { clientKey: "runtimeVersion", branchMappingOperator: "==", operand: RTV_A },
            { clientKey: "rolloutToken", branchMappingOperator: "hash_lt", operand: 1 },
          ],
        },
        { branchId: branchY, branchMappingLogic: "true" },
      ],
      salt: `salt-${suffix}`,
    });

    // channel.branch_id (the no-mapping default) points at branch Y so the
    // null-result fallback in resolveBranchId is also branch Y.
    await env.DB.prepare(
      `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, 'production', ?, ?, 0, 0, '2026-01-01T00:00:00Z')`,
    )
      .bind(`chan-${projectId}`, projectId, branchY, branchMappingJson)
      .run();

    await seedUpdate({ updateId: updateX, branchId: branchX, runtimeVersion: RTV_A });
    await seedUpdate({ updateId: updateY, branchId: branchY, runtimeVersion: RTV_B });
  });

  it("routes RTV_A clients to branch X and other RTVs to the default branch Y", async () => {
    const responseA = await fetchManifest(projectId, RTV_A);
    expect(responseA.status).toBe(200);
    expect(await manifestIdOf(responseA)).toBe(updateX);

    const responseB = await fetchManifest(projectId, RTV_B);
    expect(responseB.status).toBe(200);
    expect(await manifestIdOf(responseB)).toBe(updateY);
  });

  it("keeps RTV_A and RTV_B cache buckets separate (never cross-serves a cached manifest)", async () => {
    // Prime both buckets.
    const primeA = await fetchManifest(projectId, RTV_A);
    expect(await manifestIdOf(primeA)).toBe(updateX);
    const primeB = await fetchManifest(projectId, RTV_B);
    expect(await manifestIdOf(primeB)).toBe(updateY);

    // Re-request each: a hit must come from its OWN bucket, never the other's.
    const secondA = await fetchManifest(projectId, RTV_A);
    expect(await manifestIdOf(secondA)).toBe(updateX);
    const secondB = await fetchManifest(projectId, RTV_B);
    expect(await manifestIdOf(secondB)).toBe(updateY);
  });
});

// Backward-compat regression: a channel still carrying the LEGACY
// `hash_lt(mappingId, 0.NN)` STRING branchMappingLogic (the pre-cluster builder
// output, already written to D1) must keep bucketing correctly under the
// rewritten node interpreter. A 100% legacy threshold routes any client to the
// new branch; the `"true"` fallback otherwise routes to the old branch. The
// fixed eas-client-id makes the hash bucket deterministic across runs.
describe("manifest serving — legacy hash_lt string percentage rollout still buckets", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `legacy-rollout-${suffix}`;
  const orgId = `org-${projectId}`;
  const branchNew = `branch-new-${suffix}`;
  const branchOld = `branch-old-${suffix}`;
  const updateNew = `cccc3333-${suffix}`;
  const updateOld = `dddd4444-${suffix}`;
  const RTV = "5.0.0";

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'Legacy Org', ?, '2026-01-01T00:00:00Z')`,
    )
      .bind(orgId, orgId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "scope_key", "created_at") VALUES (?, ?, 'Legacy Project', ?, ?, '2026-01-01T00:00:00Z')`,
    )
      .bind(projectId, orgId, `slug-${projectId}`, `https://legacy-${suffix}.example`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'new', '2026-01-01T00:00:00Z')`,
    )
      .bind(branchNew, projectId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'old', '2026-01-01T00:00:00Z')`,
    )
      .bind(branchOld, projectId)
      .run();

    // LEGACY string form: 100% rollout to branchNew, `"true"` fallback to old.
    const branchMappingJson = JSON.stringify({
      data: [
        { branchId: branchNew, branchMappingLogic: "hash_lt(mappingId, 1.00)" },
        { branchId: branchOld, branchMappingLogic: "true" },
      ],
      salt: `salt-${suffix}`,
    });
    await env.DB.prepare(
      `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, 'production', ?, ?, 0, 0, '2026-01-01T00:00:00Z')`,
    )
      .bind(`chan-${projectId}`, projectId, branchOld, branchMappingJson)
      .run();

    await seedUpdate({ updateId: updateNew, branchId: branchNew, runtimeVersion: RTV });
    await seedUpdate({ updateId: updateOld, branchId: branchOld, runtimeVersion: RTV });
  });

  it("routes a hashed client into the 100% legacy hash_lt bucket (new branch)", async () => {
    const response = await fetchManifest(projectId, RTV);
    expect(response.status).toBe(200);
    expect(await manifestIdOf(response)).toBe(updateNew);

    // Deterministic across repeats (also exercises the cache hit path).
    const repeat = await fetchManifest(projectId, RTV);
    expect(await manifestIdOf(repeat)).toBe(updateNew);
  });
});
