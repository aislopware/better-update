import { toDbNull } from "@better-update/type-guards";
import { env } from "cloudflare:test";
import { Effect } from "effect";

import { UpdateRepo, UpdateRepoLive } from "../../../src/repositories/updates";
import { runWithLayerAndEnv } from "../../helpers/runtime";

import type { Platform, UpdateAssetRefModel } from "../../../src/models";

// Repository-level integration coverage (real D1 via @cloudflare/vitest-pool-workers)
// for the Kysely-converted read/aggregate/delete paths that the deleted mock-d1
// unit test used to assert: findByProject (project-scope subquery filter + the
// total_asset_size SUM correlated subselect + platform filter + pagination),
// findByGroupId, listByProjectAndFingerprint, updateRollout + hasActiveRollout,
// and deleteGroup (atomic d1Batch + returned-row count). The insert path itself
// is covered by update-git-metadata.test.ts / update-id-pinning.test.ts; here we
// drive insert only to seed.

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, UpdateRepo>) =>
  runWithLayerAndEnv(effect, UpdateRepoLive, env);

const insertAsset = (hash: string, byteSize: number) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, 'application/javascript', 'js', ?, ?, '2024-01-10T00:00:00.000Z')`,
  )
    .bind(hash, byteSize, `assets/${hash}`)
    .run();

const seedUpdate = (params: {
  readonly branchId: string;
  readonly groupId: string;
  readonly platform: Platform;
  readonly runtimeVersion: string;
  readonly message: string;
  readonly rolloutPercentage?: number;
  readonly fingerprintHash?: string | null;
  readonly gitCommit?: string | null;
  readonly assets: readonly UpdateAssetRefModel[];
}) =>
  run(
    Effect.gen(function* () {
      const repo = yield* UpdateRepo;
      return yield* repo.insert({
        branchId: params.branchId,
        runtimeVersion: params.runtimeVersion,
        platform: params.platform,
        message: params.message,
        metadataJson: "{}",
        extraJson: null,
        groupId: params.groupId,
        rolloutPercentage: params.rolloutPercentage ?? 100,
        isRollback: false,
        signature: null,
        certificateChain: null,
        manifestBody: null,
        directiveBody: null,
        fingerprintHash: toDbNull(params.fingerprintHash),
        gitCommit: toDbNull(params.gitCommit),
        gitDirty: false,
        assets: params.assets,
      });
    }),
  );

describe("UpdateRepo — Kysely read/aggregate/delete paths (real D1)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const organizationId = `org-upd-${suffix}`;
  const projectId = `proj-upd-${suffix}`;
  const branchId = `branch-upd-${suffix}`;
  const otherProjectId = `proj-upd2-${suffix}`;
  const otherBranchId = `branch-upd2-${suffix}`;
  // Asset hashes (launch + extra) so total_asset_size = 1000 + 500 = 1500.
  const launchHash = `launch-upd-${suffix}`;
  const extraHash = `extra-upd-${suffix}`;
  const androidHash = `android-upd-${suffix}`;

  const listGroup = `grp-list-${suffix}`;
  const androidGroup = `grp-android-${suffix}`;
  const fingerprint = `fp-${suffix}`;

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'Upd Org', ?, '2024-01-01')`,
    )
      .bind(organizationId, `upd-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'Upd Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, organizationId, `upd-app-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'Other Project', ?, '2024-01-01T00:00:00.000Z')`,
    )
      .bind(otherProjectId, organizationId, `upd-app2-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(branchId, projectId)
      .run();
    await env.DB.prepare(
      `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, 'main', '2024-01-01T00:00:00.000Z')`,
    )
      .bind(otherBranchId, otherProjectId)
      .run();

    await insertAsset(launchHash, 1000);
    await insertAsset(extraHash, 500);
    await insertAsset(androidHash, 700);

    // listGroup: two ios updates on rtv 1.0.0; the first carries two assets
    // (total_asset_size = 1500) and a fingerprint.
    await seedUpdate({
      branchId,
      groupId: listGroup,
      platform: "ios",
      runtimeVersion: "1.0.0",
      message: "ios-a",
      fingerprintHash: fingerprint,
      assets: [
        { key: "bundle", hash: launchHash, isLaunch: true },
        { key: "extra", hash: extraHash, isLaunch: false },
      ],
    });
    await seedUpdate({
      branchId,
      groupId: listGroup,
      platform: "ios",
      runtimeVersion: "1.0.0",
      message: "ios-b",
      assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
    });
    // androidGroup: one android update.
    await seedUpdate({
      branchId,
      groupId: androidGroup,
      platform: "android",
      runtimeVersion: "1.0.0",
      message: "android-a",
      assets: [{ key: "bundle", hash: androidHash, isLaunch: true }],
    });

    // An update under a DIFFERENT project — must never leak into project-scoped reads.
    await seedUpdate({
      branchId: otherBranchId,
      groupId: `grp-other-${suffix}`,
      platform: "ios",
      runtimeVersion: "1.0.0",
      message: "other-project",
      assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
    });
  });

  it("findByProject scopes to the project, computes total_asset_size, and totals correctly", async () => {
    const result = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.findByProject({
          projectId,
          sort: "createdAt",
          order: "desc",
          limit: 50,
          offset: 0,
        });
      }),
    );

    // 3 updates in this project (the other-project row is excluded).
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);

    const withAssets = result.items.find((item) => item.message === "ios-a");
    expect(withAssets?.totalAssetSize).toBe(1500);
    const singleAsset = result.items.find((item) => item.message === "ios-b");
    expect(singleAsset?.totalAssetSize).toBe(1000);
  });

  it("findByProject filters by platform and paginates", async () => {
    const ios = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.findByProject({
          projectId,
          platform: "ios",
          sort: "createdAt",
          order: "desc",
          limit: 1,
          offset: 0,
        });
      }),
    );

    expect(ios.total).toBe(2);
    expect(ios.items).toHaveLength(1);
    expect(ios.items[0]?.platform).toBe("ios");
  });

  it("findByProject searches message and git commit case-insensitively, totals respecting it", async () => {
    await seedUpdate({
      branchId,
      groupId: `grp-search-${suffix}`,
      platform: "ios",
      runtimeVersion: "1.0.0",
      message: "search-needle",
      gitCommit: "AbCdEf1234567890",
      assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
    });

    const search = (query: string) =>
      run(
        Effect.gen(function* () {
          const repo = yield* UpdateRepo;
          return yield* repo.findByProject({
            projectId,
            query,
            sort: "createdAt",
            order: "desc",
            limit: 50,
            offset: 0,
          });
        }),
      );

    const byMessage = await search("NEEDLE");
    expect(byMessage.total).toBe(1);
    expect(byMessage.items[0]?.message).toBe("search-needle");

    const byCommit = await search("abcdef12");
    expect(byCommit.total).toBe(1);
    expect(byCommit.items[0]?.message).toBe("search-needle");

    // The other-project row's message must not leak through the search path.
    const crossProject = await search("other-project");
    expect(crossProject.total).toBe(0);

    const noMatch = await search("zzz-no-such");
    expect(noMatch.total).toBe(0);
  });

  it("findByGroupId returns every update in the group", async () => {
    const items = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.findByGroupId({ groupId: listGroup });
      }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.message).sort()).toEqual(["ios-a", "ios-b"]);
  });

  it("listByProjectAndFingerprint returns only matching-fingerprint updates", async () => {
    const items = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.listByProjectAndFingerprint({ projectId, fingerprintHash: fingerprint });
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.message).toBe("ios-a");
  });

  it("updateRollout flips hasActiveRollout for a partial percentage", async () => {
    const rolloutGroup = `grp-rollout-${suffix}`;
    const rolloutRtv = "9.9.9";
    const inserted = await seedUpdate({
      branchId,
      groupId: rolloutGroup,
      platform: "ios",
      runtimeVersion: rolloutRtv,
      message: "rollout",
      rolloutPercentage: 100,
      assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
    });

    const tuple = { branchId, platform: "ios" as const, runtimeVersion: rolloutRtv };

    const before = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.hasActiveRollout(tuple);
      }),
    );
    expect(before).toBe(false);

    const after = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        yield* repo.updateRollout({ id: inserted.id, percentage: 40 });
        return yield* repo.hasActiveRollout(tuple);
      }),
    );
    expect(after).toBe(true);
  });

  it("deleteGroup removes the group's updates and returns the deleted count", async () => {
    const delGroup = `grp-del-${suffix}`;
    await seedUpdate({
      branchId,
      groupId: delGroup,
      platform: "ios",
      runtimeVersion: "2.0.0",
      message: "del-a",
      assets: [{ key: "bundle", hash: launchHash, isLaunch: true }],
    });
    await seedUpdate({
      branchId,
      groupId: delGroup,
      platform: "android",
      runtimeVersion: "2.0.0",
      message: "del-b",
      assets: [{ key: "bundle", hash: androidHash, isLaunch: true }],
    });

    const result = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.deleteGroup({ groupId: delGroup });
      }),
    );
    expect(result.deleted).toBe(2);

    const remaining = await run(
      Effect.gen(function* () {
        const repo = yield* UpdateRepo;
        return yield* repo.findByGroupId({ groupId: delGroup });
      }),
    );
    expect(remaining).toHaveLength(0);
  });
});
