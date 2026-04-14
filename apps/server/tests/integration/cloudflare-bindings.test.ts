import { env } from "cloudflare:test";
import { Effect } from "effect";

import { AssetStorage, AssetStorageLive } from "../../src/cloudflare/asset-storage";
import { BuildRuntime, BuildRuntimeLive } from "../../src/cloudflare/build-runtime";
import { UpdateCoordinator, UpdateCoordinatorLive } from "../../src/cloudflare/update-coordinator";
import { runWithLayerAndEnv } from "../helpers/runtime";

const textEncoder = new TextEncoder();

const runAssetStorage = <Ret, Err>(effect: Effect.Effect<Ret, Err, AssetStorage>) =>
  runWithLayerAndEnv(effect, AssetStorageLive, env);

const runBuildRuntime = <Ret, Err>(effect: Effect.Effect<Ret, Err, BuildRuntime>) =>
  runWithLayerAndEnv(effect, BuildRuntimeLive, env);

const runUpdateCoordinator = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateCoordinator>) =>
  runWithLayerAndEnv(effect, UpdateCoordinatorLive, env);

const uniqueId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const insertOrganization = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${slug}`, slug, "2026-01-01T00:00:00Z")
    .run();

const insertProject = (id: string, organizationId: string, scopeKey: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `Project ${id}`, scopeKey, "2026-01-01T00:00:00Z")
    .run();

const insertAsset = (hash: string) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(hash, "application/javascript", "js", 128, `assets/${hash}.js`, "2026-01-01T00:00:00Z")
    .run();

const readTextBody = async (body: ReadableStream | null) => new Response(body).text();

const ensureBranchChannel = async (projectId: string, branchName: string) => {
  const result = await runUpdateCoordinator(
    Effect.gen(function* () {
      const coordinator = yield* UpdateCoordinator;
      return yield* coordinator.ensureBranchChannel({ projectId, branchName });
    }),
  );

  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.value;
};

const getChannelCacheVersion = async (branchId: string) => {
  const row = await env.DB.prepare(
    `SELECT "cache_version" AS "cacheVersion" FROM "channels" WHERE "branch_id" = ?`,
  )
    .bind(branchId)
    .first<{ cacheVersion: number }>();

  return row?.cacheVersion ?? null;
};

describe("Cloudflare bindings integration", () => {
  describe("AssetStorage -- local R2", () => {
    it("stores, reads, and deletes asset objects via local R2 simulation", async () => {
      const key = `integration/assets/${crypto.randomUUID()}.txt`;
      const content = "asset body from local r2";
      const bytes = textEncoder.encode(content);

      await runAssetStorage(
        Effect.gen(function* () {
          const storage = yield* AssetStorage;
          yield* storage.putObject({
            key,
            body: bytes,
            contentType: "text/plain",
          });
        }),
      );

      const stored = await runAssetStorage(
        Effect.gen(function* () {
          const storage = yield* AssetStorage;
          return yield* storage.getObject({ key });
        }),
      );

      expect(stored).not.toBeNull();
      if (!stored) {
        throw new Error("Expected stored asset to exist");
      }

      expect(stored.size).toBe(bytes.byteLength);
      expect(stored.contentType).toBe("text/plain");
      expect(await readTextBody(stored.body)).toBe(content);

      await runAssetStorage(
        Effect.gen(function* () {
          const storage = yield* AssetStorage;
          yield* storage.deleteObjects({ keys: [key] });
        }),
      );

      expect(await env.ASSETS_BUCKET.get(key)).toBeNull();
    });
  });

  describe("BuildRuntime -- local KV and R2", () => {
    it("stores and deletes build reservations in local KV", async () => {
      const id = uniqueId("reservation");
      const value = JSON.stringify({ buildId: id, status: "reserved" });

      await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          yield* runtime.putReservation({
            id,
            value,
            ttlSeconds: 120,
          });
        }),
      );

      expect(await env.BUILD_RESERVATIONS.get(id)).toBe(value);

      const stored = await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          return yield* runtime.getReservation({ id });
        }),
      );

      expect(stored).toBe(value);

      await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          yield* runtime.deleteReservation({ id });
        }),
      );

      expect(await env.BUILD_RESERVATIONS.get(id)).toBeNull();
    });

    it("stores, lists, reads, and deletes build artifacts in local R2", async () => {
      const prefix = `integration/builds/${crypto.randomUUID()}/`;
      const keyA = `${prefix}a.ipa`;
      const keyB = `${prefix}b.apk`;
      const bytesA = textEncoder.encode("build artifact a");
      const bytesB = textEncoder.encode("build artifact b");

      await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          yield* runtime.putObject({
            key: keyA,
            body: bytesA,
            contentType: "application/octet-stream",
          });
          yield* runtime.putObject({
            key: keyB,
            body: bytesB,
            contentType: "application/octet-stream",
          });
        }),
      );

      const listed = await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          return yield* runtime.listObjects({ prefix });
        }),
      );

      expect(listed.objects.map((object) => object.key).sort()).toEqual([keyA, keyB].sort());

      const stored = await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          return yield* runtime.getObject({ key: keyA });
        }),
      );

      expect(stored).not.toBeNull();
      if (!stored) {
        throw new Error("Expected stored build artifact to exist");
      }

      expect(stored.contentType).toBe("application/octet-stream");
      expect(await readTextBody(stored.body)).toBe("build artifact a");

      await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          yield* runtime.deleteObjects({ keys: [keyA, keyB] });
        }),
      );

      expect(await env.BUILD_BUCKET.get(keyA)).toBeNull();
      expect(await env.BUILD_BUCKET.get(keyB)).toBeNull();
    });

    it("generates presigned URLs and exposes the configured install token secret", async () => {
      const key = `artifacts/${crypto.randomUUID()}.ipa`;

      const result = await runBuildRuntime(
        Effect.gen(function* () {
          const runtime = yield* BuildRuntime;
          const uploadUrl = yield* runtime.createUploadUrl({ key, expiresIn: 60 });
          const downloadUrl = yield* runtime.createDownloadUrl({ key, expiresIn: 60 });
          const installTokenSecret = yield* runtime.getInstallTokenSecret;

          return { uploadUrl, downloadUrl, installTokenSecret };
        }),
      );

      expect(result.uploadUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
      expect(result.downloadUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
      expect(decodeURIComponent(result.uploadUrl)).toContain(key);
      expect(decodeURIComponent(result.downloadUrl)).toContain(key);
      expect(result.installTokenSecret).toBe("integration-install-token-secret-at-least-32-chars");
    });
  });

  describe("UpdateCoordinator -- local Durable Objects", () => {
    it("creates a branch and channel idempotently through the local durable object binding", async () => {
      const organizationId = uniqueId("org");
      const projectId = uniqueId("project");
      const branchName = uniqueId("preview");

      await insertOrganization(organizationId, uniqueId("org-slug"));
      await insertProject(projectId, organizationId, `@integration/${projectId}`);

      const first = await ensureBranchChannel(projectId, branchName);
      expect(first.branchCreated).toBe(true);
      expect(first.channelCreated).toBe(true);

      const second = await ensureBranchChannel(projectId, branchName);
      expect(second.branchCreated).toBe(false);
      expect(second.channelCreated).toBe(false);
      expect(second.branchId).toBe(first.branchId);
      expect(second.channelId).toBe(first.channelId);
    });

    it("publishes and republishes updates through local durable object coordination", async () => {
      const organizationId = uniqueId("org");
      const projectId = uniqueId("project");
      const sourceBranch = await (async () => {
        await insertOrganization(organizationId, uniqueId("publish-org"));
        await insertProject(projectId, organizationId, `@integration/${projectId}`);
        return ensureBranchChannel(projectId, uniqueId("main"));
      })();
      const targetBranch = await ensureBranchChannel(projectId, uniqueId("preview"));
      const launchHash = uniqueId("launch-hash");

      await insertAsset(launchHash);

      const created = await runUpdateCoordinator(
        Effect.gen(function* () {
          const coordinator = yield* UpdateCoordinator;
          return yield* coordinator.createUpdate({
            coordinatorName: sourceBranch.branchId,
            payload: {
              branchId: sourceBranch.branchId,
              runtimeVersion: "1.0.0",
              platform: "ios",
              message: "integration publish",
              metadataJson: "{}",
              extraJson: null,
              groupId: uniqueId("group"),
              rolloutPercentage: 100,
              isRollback: false,
              signature: null,
              certificateChain: null,
              manifestBody: null,
              directiveBody: null,
              assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
            },
          });
        }),
      );

      expect(created.ok).toBe(true);
      if (!created.ok) {
        throw new Error(created.message);
      }

      const createdRow = await env.DB.prepare(
        `SELECT "branch_id" AS "branchId", "group_id" AS "groupId" FROM "updates" WHERE "id" = ?`,
      )
        .bind(created.value.id)
        .first<{ branchId: string; groupId: string }>();

      expect(createdRow?.branchId).toBe(sourceBranch.branchId);
      expect(await getChannelCacheVersion(sourceBranch.branchId)).toBe(1);

      const republished = await runUpdateCoordinator(
        Effect.gen(function* () {
          const coordinator = yield* UpdateCoordinator;
          return yield* coordinator.republishUpdate({
            coordinatorName: targetBranch.branchId,
            payload: {
              branchId: targetBranch.branchId,
              message: null,
              updates: [
                {
                  runtimeVersion: "1.0.0",
                  platform: "ios",
                  message: "integration publish",
                  metadataJson: "{}",
                  extraJson: null,
                  assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
                },
              ],
            },
          });
        }),
      );

      expect(republished.ok).toBe(true);
      if (!republished.ok) {
        throw new Error(republished.message);
      }
      expect(republished.value).toHaveLength(1);
      const [republishedUpdate] = republished.value;
      expect(republishedUpdate).toBeDefined();

      const republishedRow = await env.DB.prepare(
        `SELECT "branch_id" AS "branchId", "group_id" AS "groupId" FROM "updates" WHERE "id" = ?`,
      )
        .bind(republishedUpdate?.id ?? "")
        .first<{ branchId: string; groupId: string }>();

      expect(republishedRow?.branchId).toBe(targetBranch.branchId);
      expect(republishedRow?.groupId).toBeTruthy();
      expect(republishedRow?.groupId).not.toBe(createdRow?.groupId);
      expect(await getChannelCacheVersion(targetBranch.branchId)).toBe(1);

      const updateAssets = await env.DB.prepare(
        `SELECT "asset_hash" AS "assetHash", "is_launch" AS "isLaunch" FROM "update_assets" WHERE "update_id" = ?`,
      )
        .bind(republishedUpdate?.id ?? "")
        .all<{ assetHash: string; isLaunch: number }>();

      expect(updateAssets.results).toEqual([
        expect.objectContaining({
          assetHash: launchHash,
          isLaunch: 1,
        }),
      ]);
    });
  });
});
