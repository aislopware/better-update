import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { Effect } from "effect";

import worker from "../../src";
import { UpdateRepo, UpdateRepoLive } from "../../src/repositories/updates";
import { runWithLayerAndEnv } from "../helpers/runtime";

// Cross-flow integration tests for the Expo OTA bundle route (RFC-3229 / A-IM
// bsdiff content negotiation). Requests are dispatched straight into the
// worker's `fetch` handler (full route + handler + repo stack) against local D1
// + R2 via `@cloudflare/vitest-pool-workers` — no wrangler, no
// `unstable_startWorker`. Patch/full-bundle bytes are seeded directly into the
// ASSETS_BUCKET miniflare binding; D1 rows are inserted via raw prepared
// statements.

const BASE = "http://localhost";

const fetchBundle = async (
  projectId: string,
  updateId: string,
  hash: string,
  headers: Record<string, string>,
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE}/manifest/${projectId}/bundle/${updateId}/${hash}`, { headers }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
};

// -- Seed helpers -------------------------------------------------------------

const insertUpdate = (params: {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "created_at") VALUES (?, ?, ?, ?, ?, '{}', ?, 0, '2024-01-15T10:00:00.000Z')`,
  )
    .bind(
      params.id,
      params.branchId,
      params.runtimeVersion,
      params.platform,
      `update ${params.id}`,
      `group-${params.id}`,
    )
    .run();

const insertAsset = (hash: string) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, 'application/javascript', 'js', 2048, ?, '2024-01-10T00:00:00.000Z')`,
  )
    .bind(hash, `assets/${hash}`)
    .run();

const linkLaunchAsset = (updateId: string, hash: string) =>
  env.DB.prepare(
    `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, 'bundle', ?, 1)`,
  )
    .bind(updateId, hash)
    .run();

const seedFullBundle = (hash: string, bytes: Uint8Array) =>
  env.ASSETS_BUCKET.put(`assets/${hash}`, bytes);

const seedPatch = (key: string, bytes: Uint8Array) => env.ASSETS_BUCKET.put(key, bytes);

const runUpdates = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>) =>
  runWithLayerAndEnv(effect, UpdateRepoLive, env);

const FULL_BUNDLE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const PATCH_BYTES = new Uint8Array([0xff, 0xee, 0xdd, 0xcc]);

// -- (a)-(e) bundle negotiation -----------------------------------------------

describe("bundle route — A-IM bsdiff content negotiation", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-bn-${suffix}`;
  const branchId = `branch-bn-${suffix}`;
  // lowercased uuids match what the client sends + how patchR2Key keys patches.
  const fromUpdateId = `aaaaaaaa-0000-0000-0000-${suffix}00000000`;
  const toUpdateId = `bbbbbbbb-0000-0000-0000-${suffix}00000000`;
  const embeddedUpdateId = `cccccccc-0000-0000-0000-${suffix}00000000`;
  const launchHash = `launch-hash-${suffix}`;
  const runtimeVersion = "10.0.0";

  // R2 keys mirror protocol/patchR2Key: patches/{project}/{rv}/{platform}/{from}__{to}.bsdiff
  const patchFromCurrent = `patches/${projectId}/${runtimeVersion}/ios/${fromUpdateId}__${toUpdateId}.bsdiff`;
  const patchFromEmbedded = `patches/${projectId}/${runtimeVersion}/ios/${embeddedUpdateId}__${toUpdateId}.bsdiff`;

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'BN Org', ?, '2024-01-01')`,
    )
      .bind(`org-bn-${suffix}`, `bn-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'BN Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, `org-bn-${suffix}`, `bn-app-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();

    await insertAsset(launchHash);
    await insertUpdate({ id: toUpdateId, branchId, runtimeVersion, platform: "ios" });
    await linkLaunchAsset(toUpdateId, launchHash);

    await seedFullBundle(launchHash, FULL_BUNDLE_BYTES);
    await seedPatch(patchFromCurrent, PATCH_BYTES);
    await seedPatch(patchFromEmbedded, PATCH_BYTES);
  });

  const bytesOf = async (response: Response): Promise<Uint8Array> =>
    new Uint8Array(await response.arrayBuffer());

  it("(a) serves the bsdiff patch when a-im:bsdiff + matching current-update-id base", async () => {
    const response = await fetchBundle(projectId, toUpdateId, launchHash, {
      "a-im": "bsdiff",
      "expo-platform": "ios",
      "expo-runtime-version": runtimeVersion,
      "expo-current-update-id": fromUpdateId,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBe("bsdiff");
    expect(response.headers.get("expo-base-update-id")).toBe(fromUpdateId);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    // Cloudflare edge applies zstd/gzip; the worker must never set content-encoding.
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await bytesOf(response)).toEqual(PATCH_BYTES);
  });

  it("(b) falls back to the full bundle when no matching patch object exists", async () => {
    const unknownBase = `dddddddd-0000-0000-0000-${suffix}00000000`;
    const response = await fetchBundle(projectId, toUpdateId, launchHash, {
      "a-im": "bsdiff",
      "expo-platform": "ios",
      "expo-runtime-version": runtimeVersion,
      "expo-current-update-id": unknownBase,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBeNull();
    expect(response.headers.get("expo-base-update-id")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(await bytesOf(response)).toEqual(FULL_BUNDLE_BYTES);
  });

  it("(c) serves the full bundle for a legacy client with no a-im header", async () => {
    const response = await fetchBundle(projectId, toUpdateId, launchHash, {
      "expo-platform": "ios",
      "expo-runtime-version": runtimeVersion,
      // a patch base is present but the client does not advertise bsdiff
      "expo-current-update-id": fromUpdateId,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBeNull();
    expect(response.headers.get("expo-base-update-id")).toBeNull();
    expect(await bytesOf(response)).toEqual(FULL_BUNDLE_BYTES);
  });

  it("(d) serves a first-launch patch from the embedded-update-id base", async () => {
    const response = await fetchBundle(projectId, toUpdateId, launchHash, {
      "a-im": "bsdiff",
      "expo-platform": "ios",
      "expo-runtime-version": runtimeVersion,
      "expo-embedded-update-id": embeddedUpdateId,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBe("bsdiff");
    expect(response.headers.get("expo-base-update-id")).toBe(embeddedUpdateId);
    expect(await bytesOf(response)).toEqual(PATCH_BYTES);
  });

  it("(e) returns 404 on runtime-version mismatch and full bundle when the header is absent", async () => {
    const mismatch = await fetchBundle(projectId, toUpdateId, launchHash, {
      "a-im": "bsdiff",
      "expo-platform": "ios",
      "expo-runtime-version": "99.0.0",
      "expo-current-update-id": fromUpdateId,
    });
    expect(mismatch.status).toBe(404);

    const absent = await fetchBundle(projectId, toUpdateId, launchHash, {
      "expo-platform": "ios",
    });
    expect(absent.status).toBe(200);
    expect(absent.headers.get("im")).toBeNull();
    expect(await bytesOf(absent)).toEqual(FULL_BUNDLE_BYTES);
  });

  it("returns 404 for an unknown update id", async () => {
    const response = await fetchBundle(projectId, `unknown-${suffix}`, launchHash, {
      "expo-platform": "ios",
    });
    expect(response.status).toBe(404);
  });
});

// -- Item 3: opt-in HTTP 226 IM Used ------------------------------------------

// Dispatch a bundle request with an env override (EMIT_HTTP_226 toggles the
// opt-in 226 status). Cloudflare vars are strings; the worker reads
// env.EMIT_HTTP_226 === "true".
const fetchBundleWithEnv = async (
  envOverride: Record<string, string>,
  projectId: string,
  updateId: string,
  hash: string,
  headers: Record<string, string>,
): Promise<Response> => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${BASE}/manifest/${projectId}/bundle/${updateId}/${hash}`, { headers }),
    { ...env, ...envOverride } as typeof env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
};

describe("bundle route — Item 3 opt-in HTTP 226 IM Used", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-226-${suffix}`;
  const branchId = `branch-226-${suffix}`;
  const fromUpdateId = `aaaaaaaa-2222-0000-0000-${suffix}00000000`;
  const toUpdateId = `bbbbbbbb-2222-0000-0000-${suffix}00000000`;
  const launchHash = `launch-226-${suffix}`;
  const runtimeVersion = "12.0.0";
  const patchKey = `patches/${projectId}/${runtimeVersion}/ios/${fromUpdateId}__${toUpdateId}.bsdiff`;

  const patchHeaders = {
    "a-im": "bsdiff",
    "expo-platform": "ios",
    "expo-runtime-version": runtimeVersion,
    "expo-current-update-id": fromUpdateId,
  };

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, '226 Org', ?, '2024-01-01')`,
    )
      .bind(`org-226-${suffix}`, `org-226-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, '226 Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, `org-226-${suffix}`, `app-226-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();

    await insertAsset(launchHash);
    await insertUpdate({ id: toUpdateId, branchId, runtimeVersion, platform: "ios" });
    await linkLaunchAsset(toUpdateId, launchHash);
    await seedFullBundle(launchHash, FULL_BUNDLE_BYTES);
    await seedPatch(patchKey, PATCH_BYTES);
  });

  it("emits 226 for a patch when EMIT_HTTP_226=true, headers + body unchanged", async () => {
    const response = await fetchBundleWithEnv(
      { EMIT_HTTP_226: "true" },
      projectId,
      toUpdateId,
      launchHash,
      patchHeaders,
    );
    expect(response.status).toBe(226);
    expect(response.headers.get("im")).toBe("bsdiff");
    expect(response.headers.get("expo-base-update-id")).toBe(fromUpdateId);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PATCH_BYTES);
  });

  it("keeps 200 for a patch when the flag is off (default)", async () => {
    const response = await fetchBundleWithEnv(
      { EMIT_HTTP_226: "false" },
      projectId,
      toUpdateId,
      launchHash,
      patchHeaders,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBe("bsdiff");
    expect(response.headers.get("expo-base-update-id")).toBe(fromUpdateId);
  });

  it("serves the full bundle at 200 even when EMIT_HTTP_226=true", async () => {
    const unknownBase = `cccccccc-2222-0000-0000-${suffix}00000000`;
    const response = await fetchBundleWithEnv(
      { EMIT_HTTP_226: "true" },
      projectId,
      toUpdateId,
      launchHash,
      { ...patchHeaders, "expo-current-update-id": unknownBase },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(FULL_BUNDLE_BYTES);
  });
});

// -- Embedded baseline: flip + first-launch patch resolution ------------------

describe("embedded baseline — partial unique index + bundle resolution", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-emb-${suffix}`;
  const branchId = `branch-emb-${suffix}`;
  const runtimeVersion = "12.0.0";
  const targetHash = `target-hash-${suffix}`;
  const targetUpdateId = `eeeeeeee-0000-0000-0000-${suffix}00000000`;

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'Emb Org', ?, '2024-01-01')`,
    )
      .bind(`org-emb-${suffix}`, `emb-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'Emb Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, `org-emb-${suffix}`, `emb-app-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();

    // Target (the update being fetched) + its launch bundle.
    await insertAsset(targetHash);
    await insertUpdate({ id: targetUpdateId, branchId, runtimeVersion, platform: "ios" });
    await linkLaunchAsset(targetUpdateId, targetHash);
    await seedFullBundle(targetHash, FULL_BUNDLE_BYTES);
  });

  const embeddedRowCount = async () => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM "updates" WHERE "branch_id" = ? AND "runtime_version" = ? AND "platform" = 'ios' AND "is_embedded" = 1`,
    )
      .bind(branchId, runtimeVersion)
      .first<{ n: number }>();
    return row?.n ?? 0;
  };

  const insertEmbedded = (message: string) =>
    runUpdates(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        // The publish coordinator clears the prior baseline first (see
        // application/publish-coordination.ts); mirror that to respect the
        // partial unique index.
        yield* repo.clearEmbeddedBaseline({ branchId, platform: "ios", runtimeVersion });
        return yield* repo.insert({
          branchId,
          runtimeVersion,
          platform: "ios",
          message,
          metadataJson: "{}",
          extraJson: null,
          groupId: `group-emb-${message}`,
          rolloutPercentage: 100,
          isRollback: false,
          signature: null,
          certificateChain: null,
          manifestBody: null,
          directiveBody: null,
          fingerprintHash: null,
          gitCommit: null,
          gitDirty: false,
          isEmbedded: true,
          assets: [{ key: "bundle", hash: targetHash, isLaunch: true }],
        });
      }),
    );

  it("flips the embedded baseline so exactly one remains per (runtime, platform)", async () => {
    const first = await insertEmbedded("embedded-v1");
    expect(await embeddedRowCount()).toBe(1);

    const second = await insertEmbedded("embedded-v2");
    expect(second.id).not.toBe(first.id);
    // The partial unique index allows only one embedded baseline at a time.
    expect(await embeddedRowCount()).toBe(1);

    const firstRow = await env.DB.prepare(`SELECT "is_embedded" AS f FROM "updates" WHERE "id" = ?`)
      .bind(first.id)
      .first<{ f: number }>();
    expect(firstRow?.f).toBe(0);

    // The current embedded update id resolves a first-launch patch in the
    // bundle route: seed a patch keyed by (embeddedId -> target).
    const patchKey = `patches/${projectId}/${runtimeVersion}/ios/${second.id.toLowerCase()}__${targetUpdateId}.bsdiff`;
    await seedPatch(patchKey, PATCH_BYTES);

    const response = await fetchBundle(projectId, targetUpdateId, targetHash, {
      "a-im": "bsdiff",
      "expo-platform": "ios",
      "expo-runtime-version": runtimeVersion,
      "expo-embedded-update-id": second.id,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("im")).toBe("bsdiff");
    expect(response.headers.get("expo-base-update-id")).toBe(second.id.toLowerCase());
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PATCH_BYTES);
  });
});

// -- Manifest backward compat -------------------------------------------------

describe("manifest still serves a full bundle through the worker route", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-mc-${suffix}`;
  const branchId = `branch-mc-${suffix}`;
  const runtimeVersion = "13.0.0";
  const launchHash = `mc-launch-${suffix}`;
  const updateId = `ffffffff-0000-0000-0000-${suffix}00000000`;

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'MC Org', ?, '2024-01-01')`,
    )
      .bind(`org-mc-${suffix}`, `mc-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'MC Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, `org-mc-${suffix}`, `mc-app-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at") VALUES (?, ?, 'production', ?, 0, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(`chan-mc-${suffix}`, projectId, branchId)
      .run();

    await insertAsset(launchHash);
    await insertUpdate({ id: updateId, branchId, runtimeVersion, platform: "ios" });
    await linkLaunchAsset(updateId, launchHash);
    await seedFullBundle(launchHash, FULL_BUNDLE_BYTES);
  });

  const dispatch = async (path: string, headers: Record<string, string>): Promise<Response> => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`${BASE}${path}`, { headers }), env, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  };

  const parseMultipartLaunchUrl = (contentType: string, rawBody: string): string => {
    const boundary = /boundary=([^\s;]+)/.exec(contentType)?.[1] ?? "";
    const manifestPart = rawBody
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((part) => {
        const [headerSection = "", ...bodySections] = part.split("\r\n\r\n");
        return { headerSection, body: bodySections.join("\r\n\r\n").replace(/\r\n$/u, "") };
      })
      .find((part) => part.headerSection.includes('name="manifest"'));
    const manifest = JSON.parse(manifestPart?.body ?? "{}") as {
      launchAsset?: { url?: string };
    };
    return manifest.launchAsset?.url ?? "";
  };

  it("manifest launchAsset.url points at the worker bundle route and that route serves the full bundle with no a-im", async () => {
    const manifestResponse = await dispatch(`/manifest/${projectId}`, {
      "expo-protocol-version": "1",
      "expo-platform": "ios",
      "expo-runtime-version": runtimeVersion,
      "expo-channel-name": "production",
      accept: "multipart/mixed",
    });
    expect(manifestResponse.status).toBe(200);

    const contentType = manifestResponse.headers.get("content-type") ?? "";
    const launchUrl = parseMultipartLaunchUrl(contentType, await manifestResponse.text());

    // launchAsset.url is the Worker bundle route, not the raw CDN /assets/{hash}.
    expect(launchUrl).toContain(`/manifest/${projectId}/bundle/${updateId}/${launchHash}`);

    // A client that just GETs that URL with no a-im receives the full bundle.
    const path = new URL(launchUrl).pathname;
    const bundleResponse = await dispatch(path, {});
    expect(bundleResponse.status).toBe(200);
    expect(bundleResponse.headers.get("im")).toBeNull();
    expect(new Uint8Array(await bundleResponse.arrayBuffer())).toEqual(FULL_BUNDLE_BYTES);
  });
});
