import { isValidPatchKey, patchR2Key } from "@better-update/expo-protocol";
import { env } from "cloudflare:test";
import { Effect } from "effect";
import { Layer } from "effect";

import { AssetStorage, AssetStorageLive } from "../../src/cloudflare/asset-storage";
import { ChannelRepo, ChannelRepoLive } from "../../src/repositories/channels";
import { UpdateRepo, UpdateRepoLive } from "../../src/repositories/updates";
import { runWithLayerAndEnv } from "../helpers/runtime";

// Integration tests for the Stage-1 patch-pipeline plumbing the CLI consumes,
// running against the real local D1 + R2 bindings via
// `@cloudflare/vitest-pool-workers` (no wrangler, no unstable_startWorker):
//
//   (a) UpdateRepo.listPatchBases — recency, embedded-baseline force-include,
//       rollback exclusion, and (project, branch, rv, platform) scoping.
//   (b) patch-upload key building — the server builds the R2 key via the shared
//       pure patchR2Key (never trusted from the client) and isValidPatchKey
//       rejects malformed keys before any presign.
//   (c) AssetStorage round-trip — a patch written at the server-built key is
//       readable from ASSETS_BUCKET, the same bucket the bundle route reads.
//
// The HTTP presign + auth middleware path (Bearer api-key + ownership) is
// exercised by the e2e-pool suite (unstable_startWorker), which is too slow to
// auto-run; here we assert the repository + key + storage behaviour directly.

const runUpdates = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>) =>
  runWithLayerAndEnv(effect, UpdateRepoLive, env);

const insertUpdate = (params: {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly createdAt: string;
  readonly isRollback?: boolean;
  readonly isEmbedded?: boolean;
}) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "is_rollback", "is_embedded", "created_at") VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.branchId,
      params.runtimeVersion,
      params.platform,
      `update ${params.id}`,
      `group-${params.id}`,
      params.isRollback ? 1 : 0,
      params.isEmbedded ? 1 : 0,
      params.createdAt,
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

// -- (a) listPatchBases --------------------------------------------------------

describe("UpdateRepo.listPatchBases (real D1)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-pb-${suffix}`;
  const branchId = `branch-pb-${suffix}`;
  const otherBranchId = `branch-other-${suffix}`;
  const runtimeVersion = "20.0.0";

  const recentNew = `aaaa1111-0000-0000-0000-${suffix}00000000`;
  const recentOld = `aaaa2222-0000-0000-0000-${suffix}00000000`;
  const rollbackId = `aaaa3333-0000-0000-0000-${suffix}00000000`;
  const embeddedId = `aaaa4444-0000-0000-0000-${suffix}00000000`;
  const otherBranchUpdate = `aaaa5555-0000-0000-0000-${suffix}00000000`;
  const otherRuntimeUpdate = `aaaa6666-0000-0000-0000-${suffix}00000000`;
  const otherPlatformUpdate = `aaaa7777-0000-0000-0000-${suffix}00000000`;

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'PB Org', ?, '2024-01-01')`,
    )
      .bind(`org-pb-${suffix}`, `pb-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'PB Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, `org-pb-${suffix}`, `pb-app-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'release', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(otherBranchId, projectId)
      .run();

    // Each update needs a launch asset to surface in the JOIN.
    for (const id of [
      recentNew,
      recentOld,
      rollbackId,
      embeddedId,
      otherBranchUpdate,
      otherRuntimeUpdate,
      otherPlatformUpdate,
    ]) {
      await insertAsset(`launch-${id}`);
    }

    await insertUpdate({
      id: recentOld,
      branchId,
      runtimeVersion,
      platform: "ios",
      createdAt: "2024-02-01T00:00:00.000Z",
    });
    await linkLaunchAsset(recentOld, `launch-${recentOld}`);

    await insertUpdate({
      id: recentNew,
      branchId,
      runtimeVersion,
      platform: "ios",
      createdAt: "2024-02-05T00:00:00.000Z",
    });
    await linkLaunchAsset(recentNew, `launch-${recentNew}`);

    // Rollback updates must never be offered as a patch base.
    await insertUpdate({
      id: rollbackId,
      branchId,
      runtimeVersion,
      platform: "ios",
      createdAt: "2024-02-06T00:00:00.000Z",
      isRollback: true,
    });
    await linkLaunchAsset(rollbackId, `launch-${rollbackId}`);

    // Embedded baseline — old, so it falls outside a tight recent window.
    await insertUpdate({
      id: embeddedId,
      branchId,
      runtimeVersion,
      platform: "ios",
      createdAt: "2023-01-01T00:00:00.000Z",
      isEmbedded: true,
    });
    await linkLaunchAsset(embeddedId, `launch-${embeddedId}`);

    // Different branch / runtime / platform — must be scoped out.
    await insertUpdate({
      id: otherBranchUpdate,
      branchId: otherBranchId,
      runtimeVersion,
      platform: "ios",
      createdAt: "2024-02-07T00:00:00.000Z",
    });
    await linkLaunchAsset(otherBranchUpdate, `launch-${otherBranchUpdate}`);
    await insertUpdate({
      id: otherRuntimeUpdate,
      branchId,
      runtimeVersion: "99.0.0",
      platform: "ios",
      createdAt: "2024-02-07T00:00:00.000Z",
    });
    await linkLaunchAsset(otherRuntimeUpdate, `launch-${otherRuntimeUpdate}`);
    await insertUpdate({
      id: otherPlatformUpdate,
      branchId,
      runtimeVersion,
      platform: "android",
      createdAt: "2024-02-07T00:00:00.000Z",
    });
    await linkLaunchAsset(otherPlatformUpdate, `launch-${otherPlatformUpdate}`);
  });

  it("returns recent published updates with launch-asset hashes, newest first", async () => {
    const rows = await runUpdates(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.listPatchBases({
          projectId,
          branchId,
          runtimeVersion,
          platform: "ios",
          limit: 50,
        });
      }),
    );

    const ids = rows.map((row) => row.updateId);
    // Newest recent first; rollback excluded; embedded force-included.
    expect(ids).toContain(recentNew);
    expect(ids).toContain(recentOld);
    expect(ids).toContain(embeddedId);
    expect(ids).not.toContain(rollbackId);
    expect(ids).not.toContain(otherBranchUpdate);
    expect(ids).not.toContain(otherRuntimeUpdate);
    expect(ids).not.toContain(otherPlatformUpdate);

    const newRow = rows.find((row) => row.updateId === recentNew);
    expect(newRow?.launchAssetHash).toBe(`launch-${recentNew}`);
    expect(newRow?.runtimeVersion).toBe(runtimeVersion);
    expect(newRow?.platform).toBe("ios");

    // recentNew (2024-02-05) sorts ahead of recentOld (2024-02-01).
    expect(ids.indexOf(recentNew)).toBeLessThan(ids.indexOf(recentOld));

    const embeddedRow = rows.find((row) => row.updateId === embeddedId);
    expect(embeddedRow?.isEmbedded).toBe(true);
  });

  it("resolves a branch-named channel to its branchId so the CLI's channel=branch request works", async () => {
    // The CLI sends `channel: <branchName>` (it has no branchId at publish), and
    // `ensureBranchChannel` auto-creates a same-named channel on branch.create.
    // This asserts that channel resolution path lands on the right branch and the
    // resolved branchId then drives listPatchBases. Closes the P0 gap where the
    // CLI sent neither branchId nor channel and got zero candidates.
    const channelId = `chan-pb-${suffix}`;
    await env.DB.prepare(
      `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "is_paused", "created_at") VALUES (?, ?, 'main', ?, 0, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(channelId, projectId, branchId)
      .run();

    const rows = await runWithLayerAndEnv(
      Effect.gen(function* () {
        const channelRepo = yield* ChannelRepo;
        const channel = yield* channelRepo.findByProjectAndName({ projectId, name: "main" });
        // The channel named after the branch resolves to that exact branch.
        expect(channel.branchId).toBe(branchId);

        const repo = yield* UpdateRepo;
        return yield* repo.listPatchBases({
          projectId,
          branchId: channel.branchId,
          runtimeVersion,
          platform: "ios",
          limit: 50,
        });
      }),
      Layer.mergeAll(ChannelRepoLive, UpdateRepoLive),
      env,
    );

    const ids = rows.map((row) => row.updateId);
    expect(ids).toContain(recentNew);
    expect(ids).toContain(embeddedId);
  });

  it("force-includes the embedded baseline even when the recent window is exhausted", async () => {
    const rows = await runUpdates(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        // limit 1 only admits the single newest recent update; the embedded
        // baseline (much older) is appended regardless of the recency window.
        return yield* repo.listPatchBases({
          projectId,
          branchId,
          runtimeVersion,
          platform: "ios",
          limit: 1,
        });
      }),
    );

    const ids = rows.map((row) => row.updateId);
    expect(ids).toContain(recentNew);
    expect(ids).toContain(embeddedId);
    expect(ids).not.toContain(recentOld);
  });
});

// -- (b)+(c) patch key building + R2 round-trip --------------------------------

describe("patch-upload key (shared pure builder) + ASSETS_BUCKET round-trip", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-pu-${suffix}`;
  const runtimeVersion = "21.0.0";
  const fromUpdateId = `bbbb1111-0000-0000-0000-${suffix}00000000`;
  const toUpdateId = `bbbb2222-0000-0000-0000-${suffix}00000000`;

  const keyParams = {
    projectId,
    runtimeVersion,
    platform: "ios" as const,
    fromUpdateId,
    toUpdateId,
  };

  it("builds the canonical patches/ key and accepts it via isValidPatchKey", () => {
    const key = patchR2Key(keyParams);
    expect(key).toBe(
      `patches/${projectId}/${runtimeVersion}/ios/${fromUpdateId}__${toUpdateId}.bsdiff`,
    );
    expect(isValidPatchKey(key, keyParams)).toBe(true);
  });

  it("rejects a tampered/forged key for the same tuple", () => {
    const forged = `patches/${projectId}/${runtimeVersion}/ios/${fromUpdateId}__${fromUpdateId}.bsdiff`;
    expect(isValidPatchKey(forged, keyParams)).toBe(false);
    // A key that escapes the patches/ namespace must also be rejected.
    expect(isValidPatchKey(`assets/${toUpdateId}`, keyParams)).toBe(false);
    // A key for a different project tuple must be rejected.
    expect(
      isValidPatchKey(patchR2Key({ ...keyParams, projectId: "other-project" }), keyParams),
    ).toBe(false);
  });

  it("the storage adapter mints a presign for the exact server-built key", async () => {
    const key = patchR2Key(keyParams);
    const url = await runWithLayerAndEnv(
      Effect.gen(function* () {
        const storage = yield* AssetStorage;
        return yield* storage.createUploadUrl({
          key,
          contentType: "application/octet-stream",
          expiresIn: 600,
        });
      }),
      AssetStorageLive,
      env,
    );
    // The presigned URL targets the canonical patches/ key (no checksum bound).
    expect(decodeURIComponent(url)).toContain(key);
  });

  it("a patch written at the server-built key is readable from ASSETS_BUCKET", async () => {
    const key = patchR2Key(keyParams);
    const patchBytes = new Uint8Array([0x42, 0x53, 0x44, 0x49, 0x46, 0x46, 0x34, 0x30]); // BSDIFF40
    await env.ASSETS_BUCKET.put(key, patchBytes);

    // The bundle route reads patches from ASSETS_BUCKET by this exact key.
    const stored = await env.ASSETS_BUCKET.get(key);
    expect(stored).not.toBeNull();
    const storedBytes =
      stored === null ? new Uint8Array() : new Uint8Array(await stored.arrayBuffer());
    expect(storedBytes).toEqual(patchBytes);
  });
});
