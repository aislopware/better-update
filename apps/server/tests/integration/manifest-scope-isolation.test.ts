import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";

// Cross-tenant cache isolation proof + legacy NULL scope_key fallback, dispatched
// straight into worker.fetch (full route + handler + repo + Cache API stack)
// against local D1 via @cloudflare/vitest-pool-workers — no unstable_startWorker.
//
// Two projects A and B share an identical channel / platform / runtimeVersion /
// branch but carry DIFFERENT projects.scope_key origins. Because scopeKey is now
// a cache-key dimension, A must never read B's cached manifest nor B's scoped
// server-defined-headers state, and vice versa.

const BASE = "http://localhost";

const fetchManifest = async (
  projectId: string,
  headers: Record<string, string>,
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE}/manifest/${projectId}`, {
      headers: {
        "expo-protocol-version": "1",
        "expo-platform": "ios",
        "expo-runtime-version": "1.0.0",
        "expo-channel-name": "production",
        accept: "multipart/mixed",
        ...headers,
      },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
};

// Pull the `id` out of the multipart `manifest` part body.
const manifestIdOf = async (response: Response): Promise<string> => {
  const text = await response.text();
  const match = /"id"\s*:\s*"([^"]+)"/u.exec(text);
  return match?.[1] ?? "";
};

interface SeedParams {
  readonly projectId: string;
  readonly scopeKey: string | null;
  readonly branchId: string;
  readonly updateId: string;
}

const seedTenant = async (params: SeedParams) => {
  const orgId = `org-${params.projectId}`;
  await env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'Scope Org', ?, '2026-01-01T00:00:00Z')`,
  )
    .bind(orgId, orgId)
    .run();
  await env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "scope_key", "created_at") VALUES (?, ?, 'Scope Project', ?, ?, '2026-01-01T00:00:00Z')`,
  )
    .bind(params.projectId, orgId, `slug-${params.projectId}`, params.scopeKey)
    .run();
  await env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2026-01-01T00:00:00Z')`,
  )
    .bind(params.branchId, params.projectId)
    .run();
  await env.DB.prepare(
    `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, 'production', ?, NULL, 0, 0, '2026-01-01T00:00:00Z')`,
  )
    .bind(`chan-${params.projectId}`, params.projectId, params.branchId)
    .run();
  // manifest_body shortcut: the handler returns it verbatim (no asset
  // resolution), so the embedded id uniquely identifies the tenant's manifest.
  const manifestBody = JSON.stringify({
    id: params.updateId,
    createdAt: "2026-01-01T00:00:00.000Z",
    runtimeVersion: "1.0.0",
    launchAsset: { key: "bundle", contentType: "application/javascript", url: `${BASE}/x` },
    assets: [],
    metadata: {},
    extra: {},
  });
  await env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at") VALUES (?, ?, '1.0.0', 'ios', 'm', '{}', ?, 100, 0, ?, '2026-01-01T00:00:00.000Z')`,
  )
    .bind(params.updateId, params.branchId, `group-${params.updateId}`, manifestBody)
    .run();
};

const sdhRow = (projectId: string, scopeKey: string) =>
  env.DB.prepare(
    `SELECT "server_defined_headers_json" FROM "project_protocol_metadata" WHERE "project_id" = ? AND "scope_key" = ?`,
  )
    .bind(projectId, scopeKey)
    .first<{ server_defined_headers_json: string | null }>();

describe("manifest serving — scopeKey cache + metadata isolation", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectA = `scope-a-${suffix}`;
  const projectB = `scope-b-${suffix}`;
  const scopeKeyA = "https://a.example";
  const scopeKeyB = "https://b.example";
  const updateA = `aaaa1111-${suffix}`;
  const updateB = `bbbb2222-${suffix}`;

  beforeAll(async () => {
    await seedTenant({
      projectId: projectA,
      scopeKey: scopeKeyA,
      branchId: `branch-a-${suffix}`,
      updateId: updateA,
    });
    await seedTenant({
      projectId: projectB,
      scopeKey: scopeKeyB,
      branchId: `branch-b-${suffix}`,
      updateId: updateB,
    });
  });

  it("never serves project A's cached manifest or sdh state to project B (and vice versa)", async () => {
    // 1. Serve A — populates A's cache bucket + stores A's server-defined-headers.
    const firstA = await fetchManifest(projectA, { "expo-extra-params": 'foo="a"' });
    expect(firstA.status).toBe(200);
    expect(await manifestIdOf(firstA)).toBe(updateA);

    // 2. Serve B with the SAME protocol headers — must MISS A's bucket and get
    //    B's own manifest, not A's.
    const firstB = await fetchManifest(projectB, { "expo-extra-params": 'foo="b"' });
    expect(firstB.status).toBe(200);
    expect(await manifestIdOf(firstB)).toBe(updateB);

    // 3. Re-serve A — must HIT its OWN bucket (id still A's).
    const secondA = await fetchManifest(projectA, { "expo-extra-params": 'foo="a"' });
    expect(await manifestIdOf(secondA)).toBe(updateA);

    // 4. Stored server-defined-headers are isolated per (project, scopeKey).
    const storedA = await sdhRow(projectA, scopeKeyA);
    const storedB = await sdhRow(projectB, scopeKeyB);
    expect(storedA?.server_defined_headers_json).toBe(
      JSON.stringify({ "expo-extra-params": 'foo="a"' }),
    );
    expect(storedB?.server_defined_headers_json).toBe(
      JSON.stringify({ "expo-extra-params": 'foo="b"' }),
    );
    // A never has B's scopeKey row and vice versa.
    expect(await sdhRow(projectA, scopeKeyB)).toBeNull();
    expect(await sdhRow(projectB, scopeKeyA)).toBeNull();
  });

  it("wire echo for expo-extra-params is unchanged (transport untouched)", async () => {
    const response = await fetchManifest(projectA, { "expo-extra-params": 'foo="a"' });
    expect(response.headers.get("expo-server-defined-headers")).toBe(
      `expo-extra-params=:${btoa('foo="a"')}:`,
    );
    // No P1 emission yet — manifest-filters header stays absent.
    expect(response.headers.get("expo-manifest-filters")).toBeNull();
  });

  it("serves correctly for a legacy project with NULL scope_key (handler fallback)", async () => {
    const projectLegacy = `scope-legacy-${suffix}`;
    const updateLegacy = `cccc3333-${suffix}`;
    await seedTenant({
      projectId: projectLegacy,
      scopeKey: null,
      branchId: `branch-legacy-${suffix}`,
      updateId: updateLegacy,
    });

    const first = await fetchManifest(projectLegacy, {});
    expect(first.status).toBe(200);
    expect(await manifestIdOf(first)).toBe(updateLegacy);

    // Stable across requests — the fallback scopeKey (PUBLIC_API_URL origin) is
    // deterministic, so the second request hits the same cache bucket.
    const second = await fetchManifest(projectLegacy, {});
    expect(await manifestIdOf(second)).toBe(updateLegacy);
  });
});
