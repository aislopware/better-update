import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { ManifestRepo, ManifestRepoLive } from "../../../src/repositories/manifest";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, ManifestRepo>) =>
  runWithLayerAndEnv(effect, ManifestRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, ManifestRepo>) =>
  runEitherWithLayerAndEnv(effect, ManifestRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${id}`, `${id}-slug`, "2024-01-01T00:00:00Z")
    .run();

const insertProject = (id: string, organizationId: string, scopeKey: string | null) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, organizationId, `Project ${id}`, `test-${id}`, scopeKey, "2024-01-01T00:00:00Z")
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
  readonly cacheVersion: number;
  readonly isPaused: boolean;
}) =>
  env.DB.prepare(
    `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "cache_version", "is_paused", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.projectId,
      params.name,
      params.branchId,
      null,
      params.cacheVersion,
      params.isPaused ? 1 : 0,
      "2024-01-03T00:00:00Z",
    )
    .run();

const insertUpdate = (params: {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: "ios" | "android";
  readonly message: string;
  readonly createdAt: string;
  readonly rolloutPercentage: number;
}) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json", "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.id,
      params.branchId,
      params.runtimeVersion,
      params.platform,
      params.message,
      "{}",
      null,
      `group-${params.id}`,
      params.rolloutPercentage,
      0,
      null,
      null,
      null,
      null,
      params.createdAt,
    )
    .run();

const insertAsset = (params: {
  readonly hash: string;
  readonly contentType: string;
  readonly fileExt: string;
  readonly byteSize: number;
  readonly contentChecksum: string;
}) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "content_checksum", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      params.hash,
      params.contentType,
      params.fileExt,
      params.byteSize,
      `assets/${params.hash}`,
      params.contentChecksum,
      "2024-01-04T00:00:00Z",
    )
    .run();

const insertUpdateAsset = (params: {
  readonly updateId: string;
  readonly assetKey: string;
  readonly assetHash: string;
  readonly isLaunch: boolean;
}) =>
  env.DB.prepare(
    `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, ?, ?, ?)`,
  )
    .bind(params.updateId, params.assetKey, params.assetHash, params.isLaunch ? 1 : 0)
    .run();

// ── Setup ─────────────────────────────────────────────────────────

const PROJECT_ID = "proj-mf";
const BRANCH_ID = "branch-mf";
const SCOPE_KEY = "scope-mf";

beforeAll(async () => {
  await insertOrg("org-mf");
  await insertProject(PROJECT_ID, "org-mf", SCOPE_KEY);
  await insertBranch(BRANCH_ID, PROJECT_ID, "main");
  await insertChannel({
    id: "chan-mf",
    projectId: PROJECT_ID,
    name: "production",
    branchId: BRANCH_ID,
    cacheVersion: 7,
    isPaused: true,
  });

  // iOS / 1.0.0: two fully-rolled-out plus a newer partial (50%) rollout.
  await insertUpdate({
    id: "upd-1",
    branchId: BRANCH_ID,
    runtimeVersion: "1.0.0",
    platform: "ios",
    message: "first",
    createdAt: "2024-02-01T00:00:00Z",
    rolloutPercentage: 100,
  });
  await insertUpdate({
    id: "upd-2",
    branchId: BRANCH_ID,
    runtimeVersion: "1.0.0",
    platform: "ios",
    message: "second",
    createdAt: "2024-02-02T00:00:00Z",
    rolloutPercentage: 100,
  });
  await insertUpdate({
    id: "upd-3",
    branchId: BRANCH_ID,
    runtimeVersion: "1.0.0",
    platform: "ios",
    message: "third (canary)",
    createdAt: "2024-02-03T00:00:00Z",
    rolloutPercentage: 50,
  });

  // android / 1.0.0: only a partial rollout, so no fully-rolled-out update.
  await insertUpdate({
    id: "upd-android",
    branchId: BRANCH_ID,
    runtimeVersion: "1.0.0",
    platform: "android",
    message: "android canary",
    createdAt: "2024-02-04T00:00:00Z",
    rolloutPercentage: 50,
  });

  // Assets for upd-2: one launch bundle + one ordinary asset.
  await insertAsset({
    hash: "hash-launch",
    contentType: "application/octet-stream",
    fileExt: ".bundle",
    byteSize: 100,
    contentChecksum: "chk-launch",
  });
  await insertAsset({
    hash: "hash-extra",
    contentType: "image/png",
    fileExt: ".png",
    byteSize: 50,
    contentChecksum: "chk-extra",
  });
  await insertUpdateAsset({
    updateId: "upd-2",
    assetKey: "bundle.js",
    assetHash: "hash-launch",
    isLaunch: true,
  });
  await insertUpdateAsset({
    updateId: "upd-2",
    assetKey: "assets/logo",
    assetHash: "hash-extra",
    isLaunch: false,
  });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("ManifestRepo — D1 integration (Kysely + session)", () => {
  it("resolveChannel returns the joined channel + project scope_key", async () => {
    const channel = await run(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.resolveChannel({ projectId: PROJECT_ID, channelName: "production" });
      }),
    );

    expect(channel).toEqual({
      branch_id: BRANCH_ID,
      branch_mapping_json: null,
      cache_version: 7,
      is_paused: 1,
      scope_key: SCOPE_KEY,
    });
  });

  it("resolveChannel fails with NotFound when the channel is absent", async () => {
    const result = await runEither(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.resolveChannel({ projectId: PROJECT_ID, channelName: "ghost" });
      }),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toMatchObject({ _tag: "NotFound", message: "Channel not found" });
    }
  });

  it("resolveUpdates returns matching updates newest-first, capped at two", async () => {
    const rows = await run(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.resolveUpdates({
          branchId: BRANCH_ID,
          platform: "ios",
          runtimeVersion: "1.0.0",
        });
      }),
    );

    expect(rows.map((row) => row.id)).toEqual(["upd-3", "upd-2"]);
    expect(rows.every((row) => row.platform === "ios" && row.runtime_version === "1.0.0")).toBe(
      true,
    );
  });

  it("resolveFullyRolledOutUpdate skips the newer partial rollout", async () => {
    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.resolveFullyRolledOutUpdate({
          branchId: BRANCH_ID,
          platform: "ios",
          runtimeVersion: "1.0.0",
        });
      }),
    );

    expect(row?.id).toBe("upd-2");
    expect(row?.rollout_percentage).toBe(100);
  });

  it("resolveFullyRolledOutUpdate returns null when nothing is fully rolled out", async () => {
    const row = await run(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.resolveFullyRolledOutUpdate({
          branchId: BRANCH_ID,
          platform: "android",
          runtimeVersion: "1.0.0",
        });
      }),
    );

    expect(row).toBeNull();
  });

  it("findUpdateAssets / findLaunchAssetForUpdate join through to the asset rows", async () => {
    const assets = await run(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.findUpdateAssets({ updateId: "upd-2" });
      }),
    );
    expect(assets.map((asset) => asset.hash).sort()).toEqual(["hash-extra", "hash-launch"]);

    const launch = await run(
      Effect.gen(function* () {
        const repo = yield* ManifestRepo;
        return yield* repo.findLaunchAssetForUpdate({ updateId: "upd-2" });
      }),
    );
    expect(launch).toEqual({
      hash: "hash-launch",
      r2_key: "assets/hash-launch",
      content_type: "application/octet-stream",
      runtime_version: "1.0.0",
    });
  });
});
