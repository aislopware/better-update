import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";

import worker from "../../src";

// Anti-brick ingestion + manifest-filters emission, dispatched straight into
// worker.fetch (full route + handler + repo + Cache API stack) against local D1
// via @cloudflare/vitest-pool-workers — no unstable_startWorker.
//
// Proves the load-bearing safety invariants of the P1 cluster:
//   (A) a device-reported failed update is NEVER served — the prior good update
//       is served instead;
//   (B) the never-strand backstop: when EVERY candidate is reported failed, the
//       server returns 204 (not an error, not an empty manifest);
//   (C) the skip is opt-in: with no failed-ids header the latest update serves;
//   (D) expo-manifest-filters is EMITTED from the P0c store and OMITTED when the
//       row is absent/empty;
//   (E) ingesting Expo-Fatal-Error never alters the served manifest (telemetry
//       isolation).

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

interface SeedTenantParams {
  readonly projectId: string;
  readonly scopeKey: string | null;
  readonly branchId: string;
}

const seedTenant = async (params: SeedTenantParams) => {
  const orgId = `org-${params.projectId}`;
  await env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'AntiBrick Org', ?, '2026-01-01T00:00:00Z')`,
  )
    .bind(orgId, orgId)
    .run();
  await env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "scope_key", "created_at") VALUES (?, ?, 'AntiBrick Project', ?, ?, '2026-01-01T00:00:00Z')`,
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
};

interface SeedUpdateParams {
  readonly branchId: string;
  readonly updateId: string;
  readonly createdAt: string;
  readonly metadata: Record<string, unknown>;
  readonly rolloutPercentage?: number;
}

const seedUpdate = async (params: SeedUpdateParams) => {
  // manifest_body shortcut: the handler returns it verbatim (no asset
  // resolution), so the embedded id uniquely identifies which update was chosen.
  const manifestBody = JSON.stringify({
    id: params.updateId,
    createdAt: params.createdAt,
    runtimeVersion: "1.0.0",
    launchAsset: { key: "bundle", contentType: "application/javascript", url: `${BASE}/x` },
    assets: [],
    metadata: {},
    extra: {},
  });
  await env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "manifest_body", "created_at") VALUES (?, ?, '1.0.0', 'ios', 'm', ?, ?, ?, 0, ?, ?)`,
  )
    .bind(
      params.updateId,
      params.branchId,
      JSON.stringify(params.metadata),
      `group-${params.updateId}`,
      params.rolloutPercentage ?? 100,
      manifestBody,
      params.createdAt,
    )
    .run();
};

const setManifestFilters = async (projectId: string, scopeKey: string, json: string | null) => {
  await env.DB.prepare(
    `INSERT INTO "project_protocol_metadata" ("project_id", "scope_key", "manifest_filters_json") VALUES (?, ?, ?) ON CONFLICT("project_id", "scope_key") DO UPDATE SET "manifest_filters_json" = excluded."manifest_filters_json"`,
  )
    .bind(projectId, scopeKey, json)
    .run();
};

describe("manifest serving — anti-brick failed-update skip + filters emission", () => {
  const suffix = crypto.randomUUID().slice(0, 8);

  // (A)/(B)/(C): two updates on one branch — newer U2 (latest) + older good U1.
  const skipProject = `ab-skip-${suffix}`;
  const skipScope = "https://skip.example";
  const skipBranch = `branch-skip-${suffix}`;
  const u1 = `11111111-${suffix}`; // older good
  const u2 = `22222222-${suffix}`; // newer (latest)

  // (D): filters emission tenant.
  const filterProject = `ab-filter-${suffix}`;
  const filterScope = "https://filter.example";
  const filterBranch = `branch-filter-${suffix}`;
  const uFilter = `33333333-${suffix}`;

  // (E): fatal-error telemetry isolation tenant.
  const fatalProject = `ab-fatal-${suffix}`;
  const fatalScope = "https://fatal.example";
  const fatalBranch = `branch-fatal-${suffix}`;
  const uFatal = `44444444-${suffix}`;

  // (G): malformed-stored-filter anti-brick tenant. A stored filter whose keys /
  // values are NOT SFV-conformant (uppercase key, spaced key, non-ASCII value)
  // must NOT 500 the manifest path — the header is simply omitted and the update
  // still serves. Proves serializeManifestFilters degrades to "" rather than
  // throwing an Effect defect.
  const badProject = `ab-bad-${suffix}`;
  const badScope = "https://bad.example";
  const badBranch = `branch-bad-${suffix}`;
  const uBad = `66666666-${suffix}`;

  // (F): rollout-fallback gap — the rollout fallback query re-reads D1 for the
  // newest 100%-rollout update, bypassing the in-memory servable narrowing. Two
  // newer rollout-0 updates push the older reported-FAILED rollout-100 update
  // out of the LIMIT-2 candidate window, so only the fallback query can surface
  // it. The final anti-brick guard must catch it -> 204, never serve it.
  const fbProject = `ab-fallback-${suffix}`;
  const fbScope = "https://fallback.example";
  const fbBranch = `branch-fallback-${suffix}`;
  const fbNewA = `5a5a5a5a-${suffix}`; // newest, rollout 0
  const fbNewB = `5b5b5b5b-${suffix}`; // rollout 0
  const fbFailed = `5f5f5f5f-${suffix}`; // oldest, rollout 100, reported failed

  beforeAll(async () => {
    await seedTenant({ projectId: skipProject, scopeKey: skipScope, branchId: skipBranch });
    await seedUpdate({
      branchId: skipBranch,
      updateId: u1,
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    });
    await seedUpdate({
      branchId: skipBranch,
      updateId: u2,
      createdAt: "2026-01-02T00:00:00.000Z",
      metadata: {},
    });

    await seedTenant({ projectId: filterProject, scopeKey: filterScope, branchId: filterBranch });
    await seedUpdate({
      branchId: filterBranch,
      updateId: uFilter,
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: { channel: "prod" },
    });

    await seedTenant({ projectId: fatalProject, scopeKey: fatalScope, branchId: fatalBranch });
    await seedUpdate({
      branchId: fatalBranch,
      updateId: uFatal,
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    });

    await seedTenant({ projectId: badProject, scopeKey: badScope, branchId: badBranch });
    await seedUpdate({
      branchId: badBranch,
      updateId: uBad,
      createdAt: "2026-01-01T00:00:00.000Z",
      // metadata.channel matches the ONE conformant filter key that survives
      // ingest, so the update is still selected server-side.
      metadata: { channel: "prod" },
    });

    await seedTenant({ projectId: fbProject, scopeKey: fbScope, branchId: fbBranch });
    await seedUpdate({
      branchId: fbBranch,
      updateId: fbFailed,
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
      rolloutPercentage: 100,
    });
    await seedUpdate({
      branchId: fbBranch,
      updateId: fbNewB,
      createdAt: "2026-01-02T00:00:00.000Z",
      metadata: {},
      rolloutPercentage: 0,
    });
    await seedUpdate({
      branchId: fbBranch,
      updateId: fbNewA,
      createdAt: "2026-01-03T00:00:00.000Z",
      metadata: {},
      rolloutPercentage: 0,
    });
  });

  it("(C) no failed-ids header -> serves the latest update (skip is opt-in)", async () => {
    const response = await fetchManifest(skipProject, {});
    expect(response.status).toBe(200);
    expect(await manifestIdOf(response)).toBe(u2);
  });

  it("(A) device reports the latest update failed -> serves the prior good update, never the failed one", async () => {
    const response = await fetchManifest(skipProject, {
      "expo-recent-failed-update-ids": `"${u2}"`,
    });
    expect(response.status).toBe(200);
    const servedId = await manifestIdOf(response);
    expect(servedId).toBe(u1);
    expect(servedId).not.toBe(u2);
  });

  it("(B) device reports BOTH candidates failed -> 204 no-update (never-strand, no error, empty body)", async () => {
    const response = await fetchManifest(skipProject, {
      "expo-recent-failed-update-ids": `"${u1}", "${u2}"`,
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("(A') a per-device skip result is never written into the shared per-tenant cache", async () => {
    // Re-fetch with NO failed-ids: a healthy device must still get the latest
    // update (proves the skip in (A)/(B) never poisoned the shared cache).
    const response = await fetchManifest(skipProject, {});
    expect(response.status).toBe(200);
    expect(await manifestIdOf(response)).toBe(u2);
  });

  it("(D) emits expo-manifest-filters from the store and serves a matching update", async () => {
    await setManifestFilters(filterProject, filterScope, JSON.stringify({ channel: "prod" }));
    const response = await fetchManifest(filterProject, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("expo-manifest-filters")).toBe(`channel="prod"`);
    // metadata.channel === "prod" matches the configured filter server-side too.
    expect(await manifestIdOf(response)).toBe(uFilter);
  });

  it("(D') omits expo-manifest-filters when the stored row is cleared (safe empty default)", async () => {
    await setManifestFilters(filterProject, filterScope, null);
    const response = await fetchManifest(filterProject, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("expo-manifest-filters")).toBeNull();
    expect(await manifestIdOf(response)).toBe(uFilter);
  });

  it("(F) rollout-fallback never serves a reported-failed update surfaced only via the fallback query", async () => {
    // Two newer rollout-0 updates force the rollout fallback to re-query D1,
    // which returns the older rollout-100 update — which the device reported
    // failed. The final guard must reject it -> 204, never a 200 serving it.
    const response = await fetchManifest(fbProject, {
      "eas-client-id": `client-${suffix}`,
      "expo-recent-failed-update-ids": `"${fbFailed}"`,
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("(G) a fully non-SFV-conformant stored filter does NOT 500 — header omitted, update still serves", async () => {
    // Uppercase key + spaced key + non-ASCII value: every entry is dropped at
    // ingest, so the map is empty -> NO header. The manifest path must return 200
    // (never 500 from a serialize throw becoming an Effect defect).
    await setManifestFilters(
      badProject,
      badScope,
      JSON.stringify({ Channel: "prod", "my channel": "x", name: "café" }),
    );
    const response = await fetchManifest(badProject, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("expo-manifest-filters")).toBeNull();
    expect(await manifestIdOf(response)).toBe(uBad);
  });

  it("(G') a mixed conformant + non-conformant stored filter emits ONLY the conformant subset", async () => {
    // `channel` is SFV-conformant and survives; `Channel` (uppercase) is dropped.
    // The emitted header carries only the survivor, and the update whose metadata
    // matches that survivor still serves (no 500, no strand).
    await setManifestFilters(
      badProject,
      badScope,
      JSON.stringify({ Channel: "ignored", channel: "prod" }),
    );
    const response = await fetchManifest(badProject, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("expo-manifest-filters")).toBe(`channel="prod"`);
    expect(await manifestIdOf(response)).toBe(uBad);
  });

  it("(E) Expo-Fatal-Error does not alter the served manifest (telemetry isolation)", async () => {
    const without = await fetchManifest(fatalProject, {});
    const withFatal = await fetchManifest(fatalProject, {
      "expo-fatal-error": "TypeError: undefined is not a function (anti-brick telemetry)",
    });
    expect(without.status).toBe(withFatal.status);
    expect(await manifestIdOf(without)).toBe(uFatal);
    expect(await manifestIdOf(withFatal)).toBe(uFatal);
  });
});
