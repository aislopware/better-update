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

const insertProject = (id: string, organizationId: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `Project ${id}`, slug, "2026-01-01T00:00:00Z")
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

const countUpdatesOnBranch = async (branchId: string) => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS "count" FROM "updates" WHERE "branch_id" = ?`,
  )
    .bind(branchId)
    .first<{ count: number }>();

  return row?.count ?? 0;
};

const setupPublishBranch = async (slugPrefix: string) => {
  const organizationId = uniqueId("org");
  const projectId = uniqueId("project");
  await insertOrganization(organizationId, uniqueId(slugPrefix));
  await insertProject(projectId, organizationId, `@integration/${projectId}`);
  const branch = await ensureBranchChannel(projectId, uniqueId("main"));
  const launchHash = uniqueId("launch-hash");
  await insertAsset(launchHash);
  return { branch, launchHash };
};

const createUpdateOnBranch = (params: {
  readonly branchId: string;
  readonly launchHash: string;
  readonly rolloutPercentage: number;
  readonly groupId: string;
}) =>
  runUpdateCoordinator(
    Effect.gen(function* () {
      const coordinator = yield* UpdateCoordinator;
      return yield* coordinator.createUpdate({
        coordinatorName: params.branchId,
        payload: {
          branchId: params.branchId,
          runtimeVersion: "1.0.0",
          platform: "ios",
          message: "concurrent publish",
          metadataJson: "{}",
          extraJson: null,
          groupId: params.groupId,
          rolloutPercentage: params.rolloutPercentage,
          isRollback: false,
          signature: null,
          certificateChain: null,
          manifestBody: null,
          directiveBody: null,
          fingerprintHash: null,
          gitCommit: null,
          gitDirty: false,
          assets: [{ key: "bundle", hash: params.launchHash, isLaunch: true }],
        },
      });
    }),
  );

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
          const uploadUrl = yield* runtime.createUploadUrl({
            key,
            expiresIn: 60,
            contentType: "application/octet-stream",
            checksumSha256Base64: Buffer.alloc(32, 1).toString("base64"),
          });
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
              fingerprintHash: null,
              gitCommit: null,
              gitDirty: false,
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
                  signature: null,
                  certificateChain: null,
                  manifestBody: null,
                  directiveBody: null,
                  fingerprintHash: null,
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

    it("serializes concurrent publishes so only one wins while a rollout is active", async () => {
      const { branch, launchHash } = await setupPublishBranch("concurrent-rollout-org");

      // Four publishes at 50% race on the same branch coordinator. The semaphore
      // serializes them; the first inserts a 50% rollout, after which every other
      // attempt hits the active-rollout guard and is rejected.
      const results = await Promise.all([
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 50,
          groupId: uniqueId("group-a"),
        }),
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 50,
          groupId: uniqueId("group-b"),
        }),
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 50,
          groupId: uniqueId("group-c"),
        }),
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 50,
          groupId: uniqueId("group-d"),
        }),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(3);
      expect(await countUpdatesOnBranch(branch.branchId)).toBe(1);
    });

    it("serializes concurrent 100% publishes without dropping updates or cache-version bumps", async () => {
      const { branch, launchHash } = await setupPublishBranch("concurrent-stable-org");

      // Three fully-rolled-out publishes race on the same branch. None trip the
      // rollout guard, so all must succeed. Because the permit is released after
      // each (no stuck lock) and cache_version is a serialized read-modify-write,
      // all three updates land and cache_version is bumped exactly three times.
      const results = await Promise.all([
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 100,
          groupId: uniqueId("group-a"),
        }),
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 100,
          groupId: uniqueId("group-b"),
        }),
        createUpdateOnBranch({
          branchId: branch.branchId,
          launchHash,
          rolloutPercentage: 100,
          groupId: uniqueId("group-c"),
        }),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(await countUpdatesOnBranch(branch.branchId)).toBe(3);
      expect(await getChannelCacheVersion(branch.branchId)).toBe(3);
    });
  });
});
