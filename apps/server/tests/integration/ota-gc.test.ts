import { patchR2Key } from "@better-update/expo-protocol";
import { env } from "cloudflare:test";
import { Effect, Layer } from "effect";

import { reapPatches, reapUpdates } from "../../src/application/ota-reaper";
import { computeCutoff } from "../../src/domain/gc-utils";
import { BundleRepoLive } from "../../src/repositories/bundle";
import { ChannelRepoLive } from "../../src/repositories/channels";
import { ProjectRepoLive } from "../../src/repositories/projects";
import { UpdateRepoLive } from "../../src/repositories/updates";
import { runWithLayerAndEnv } from "../helpers/runtime";

// Integration tests for the OTA retention reaper against the real local D1 + R2
// bindings (@cloudflare/vitest-pool-workers — no wrangler, no startWorker).
//
// Drives the application/ota-reaper programs directly with explicit cutoffs (the
// handler only wraps these with env-var parsing + ServerInfrastructureLayer). It
// verifies the HARD safety invariant end to end: reap an old, unreferenced
// update group + its now-unshared asset + an orphaned patch blob, while keeping
// every channel-current / embedded / in-flight-rollout update, every shared
// asset, and every live/within-TTL patch.

const ReaperLayer = Layer.mergeAll(
  ProjectRepoLive,
  ChannelRepoLive,
  UpdateRepoLive,
  BundleRepoLive,
);

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, never>) =>
  runWithLayerAndEnv(effect.pipe(Effect.provide(ReaperLayer)), Layer.empty, env);

// Far past / future so the retention windows are unambiguous.
const OLD = "2020-01-01T00:00:00.000Z";
const RECENT = "2099-01-01T00:00:00.000Z";
const UPDATE_CUTOFF = computeCutoff(90);
const PATCH_CUTOFF = computeCutoff(30);
// Mirrors IN_CHUNK in repositories/update-reaper-sql.ts: a reap of MORE than
// this many updates proves the id-list chunking spanned multiple statements
// without tripping D1's 100-bound-parameter ceiling.
const IN_CHUNK_THRESHOLD = 80;

const insertUpdate = (params: {
  readonly id: string;
  readonly branchId: string;
  readonly groupId: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly createdAt: string;
  readonly rolloutPercentage?: number;
  readonly isEmbedded?: boolean;
}) =>
  env.DB.prepare(
    `INSERT INTO "updates" ("id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "group_id", "rollout_percentage", "is_rollback", "is_embedded", "created_at") VALUES (?, ?, ?, ?, ?, '{}', ?, ?, 0, ?, ?)`,
  )
    .bind(
      params.id,
      params.branchId,
      params.runtimeVersion,
      params.platform,
      `update ${params.id}`,
      params.groupId,
      params.rolloutPercentage ?? 100,
      params.isEmbedded ? 1 : 0,
      params.createdAt,
    )
    .run();

const insertAsset = (hash: string) =>
  env.DB.prepare(
    `INSERT OR IGNORE INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, 'application/javascript', 'js', 2048, ?, '2020-01-01T00:00:00.000Z')`,
  )
    .bind(hash, `assets/${hash}`)
    .run();

const linkAsset = (updateId: string, hash: string, isLaunch: boolean) =>
  env.DB.prepare(
    `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, ?, ?, ?)`,
  )
    .bind(updateId, `key-${hash}`, hash, isLaunch ? 1 : 0)
    .run();

describe("OTA reaper (real D1 + R2)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-gc-${suffix}`;
  const branchChannel = `branch-chan-${suffix}`;
  const branchRolloutOld = `branch-ro-${suffix}`;
  const branchRolloutNew = `branch-rn-${suffix}`;
  const branchUnref = `branch-unref-${suffix}`;
  const rv = "30.0.0";

  // ids lowercased on disk in patch keys.
  const uOldUnref = `1111aaaa-0000-0000-0000-${suffix}00000000`;
  const uRecent = `2222aaaa-0000-0000-0000-${suffix}00000000`;
  const uCurrent = `3333aaaa-0000-0000-0000-${suffix}00000000`;
  const uEmbedded = `4444aaaa-0000-0000-0000-${suffix}00000000`;
  const uRolloutPrev = `5555aaaa-0000-0000-0000-${suffix}00000000`;
  const uRolloutNew = `6666aaaa-0000-0000-0000-${suffix}00000000`;

  const hashA = `hasha-${suffix}`; // launch asset of uOldUnref only
  const hashS = `hashs-${suffix}`; // shared between uOldUnref and uRecent
  const hashEmbedded = `hashe-${suffix}`;

  const orphanPatchKey = patchR2Key({
    projectId,
    runtimeVersion: rv,
    platform: "ios",
    fromUpdateId: uEmbedded,
    toUpdateId: uOldUnref,
  });
  const livePatchKey = patchR2Key({
    projectId,
    runtimeVersion: rv,
    platform: "ios",
    fromUpdateId: uEmbedded,
    toUpdateId: uCurrent,
  });
  // A patch whose `to` (uOldUnref) is reaped. Created fresh inside the TTL test
  // (after the RECENT sweep) so the within-TTL guard can be asserted in isolation.
  const ttlGuardedPatchKey = patchR2Key({
    projectId,
    runtimeVersion: rv,
    platform: "android",
    fromUpdateId: uEmbedded,
    toUpdateId: uOldUnref,
  });

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'GC Org', ?, '2020-01-01')`,
    )
      .bind(`org-gc-${suffix}`, `gc-org-${suffix}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'GC Project', ?, '2020-01-01T00:00:00.000Z')`,
    )
      .bind(projectId, `org-gc-${suffix}`, `gc-app-${suffix}`)
      .run();

    for (const [id, name] of [
      [branchChannel, "main"],
      [branchRolloutOld, "rollout-old"],
      [branchRolloutNew, "rollout-new"],
      [branchUnref, "unref"],
    ] as const) {
      await env.DB.prepare(
        `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z')`,
      )
        .bind(id, projectId, name)
        .run();
    }

    // Channel currently serves branchChannel and is gradually rolling out to
    // branchRolloutNew (reachable via branch_mapping_json).
    const branchMapping = JSON.stringify({
      data: [
        { branchId: branchRolloutNew, branchMappingLogic: "hash_lt(mappingId, 0.50)" },
        { branchId: branchRolloutOld, branchMappingLogic: "true" },
      ],
      salt: "s",
    });
    await env.DB.prepare(
      `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "is_paused", "created_at") VALUES (?, ?, 'production', ?, ?, 0, '2020-01-01T00:00:00.000Z')`,
    )
      .bind(`chan-prod-${suffix}`, projectId, branchChannel, branchMapping)
      .run();

    await insertAsset(hashA);
    await insertAsset(hashS);
    await insertAsset(hashEmbedded);

    // uOldUnref: old, on unref branch, NOT newest (shadowed by uRecent),
    // references launch hashA + shared hashS.
    await insertUpdate({
      id: uOldUnref,
      branchId: branchUnref,
      groupId: `grp-oldunref-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: OLD,
    });
    await linkAsset(uOldUnref, hashA, true);
    await linkAsset(uOldUnref, hashS, false);

    // Filler updates so uOldUnref falls OUTSIDE the recent patch-base window
    // (PATCH_BASE_PROTECT_LIMIT). Without these, every launch-asset update ranks
    // in the top-N per tuple and is protected as a current base (clause 5), so
    // uOldUnref would never be reapable. These shield it (clause 2) AND push it
    // out of the base window so it becomes eligible.
    for (let index = 0; index < 12; index += 1) {
      const fillerId = `f${index}-filler-${suffix}`;
      const fillerHash = `hashf${index}-${suffix}`;
      await insertAsset(fillerHash);
      await insertUpdate({
        id: fillerId,
        branchId: branchUnref,
        groupId: `grp-filler-${index}-${suffix}`,
        runtimeVersion: rv,
        platform: "ios",
        createdAt: `2021-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      });
      await linkAsset(fillerId, fillerHash, true);
    }

    // uRecent: newest on unref branch (shields uOldUnref), references shared hashS.
    await insertUpdate({
      id: uRecent,
      branchId: branchUnref,
      groupId: `grp-recent-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: RECENT,
    });
    await linkAsset(uRecent, hashS, true);

    // uCurrent: channel-current newest on branchChannel (keep).
    await insertUpdate({
      id: uCurrent,
      branchId: branchChannel,
      groupId: `grp-current-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: OLD,
    });
    await insertAsset(`hashc-${suffix}`);
    await linkAsset(uCurrent, `hashc-${suffix}`, true);

    // uEmbedded: embedded baseline (keep).
    await insertUpdate({
      id: uEmbedded,
      branchId: branchChannel,
      groupId: `grp-embedded-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: OLD,
      isEmbedded: true,
    });
    await linkAsset(uEmbedded, hashEmbedded, true);

    // In-flight rollout on branchRolloutNew: prev (=100) + new (50, in flight).
    await insertUpdate({
      id: uRolloutPrev,
      branchId: branchRolloutNew,
      groupId: `grp-roprev-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: OLD,
      rolloutPercentage: 100,
    });
    await insertAsset(`hashrp-${suffix}`);
    await linkAsset(uRolloutPrev, `hashrp-${suffix}`, true);
    await insertUpdate({
      id: uRolloutNew,
      branchId: branchRolloutNew,
      groupId: `grp-ronew-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: RECENT,
      rolloutPercentage: 50,
    });
    await insertAsset(`hashrn-${suffix}`);
    await linkAsset(uRolloutNew, `hashrn-${suffix}`, true);

    // R2: the two unshared/shared assets + three patch blobs.
    await env.ASSETS_BUCKET.put(`assets/${hashA}`, new Uint8Array([1]));
    await env.ASSETS_BUCKET.put(`assets/${hashS}`, new Uint8Array([2]));
    await env.ASSETS_BUCKET.put(orphanPatchKey, new Uint8Array([3]));
    await env.ASSETS_BUCKET.put(livePatchKey, new Uint8Array([4]));
    // The within-TTL guard patch is created inside its own test (after the
    // first RECENT sweep), since with patchCutoff=RECENT it would be reaped.
  });

  it("reaps the old unreferenced group + its now-unshared asset + orphaned patch", async () => {
    const result = await run(
      Effect.gen(function* () {
        const updates = yield* reapUpdates({ cutoff: UPDATE_CUTOFF });
        const patches = yield* reapPatches({ patchCutoff: RECENT });
        return { updates, patches };
      }),
    );

    expect(result.updates.updatesDeleted).toBeGreaterThanOrEqual(1);

    // uOldUnref gone from updates + update_assets.
    const oldRow = await env.DB.prepare(`SELECT "id" FROM "updates" WHERE "id" = ?`)
      .bind(uOldUnref)
      .first();
    expect(oldRow).toBeNull();
    const oldAssets = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM "update_assets" WHERE "update_id" = ?`,
    )
      .bind(uOldUnref)
      .first<{ c: number }>();
    expect(oldAssets?.c).toBe(0);

    // assets/{hashA} deleted from R2 AND its assets row gone (now-unshared).
    expect(await env.ASSETS_BUCKET.get(`assets/${hashA}`)).toBeNull();
    const assetRow = await env.DB.prepare(`SELECT "hash" FROM "assets" WHERE "hash" = ?`)
      .bind(hashA)
      .first();
    expect(assetRow).toBeNull();

    // The orphaned patch (its `to` reaped) is gone (patchCutoff=RECENT => beyond TTL).
    expect(await env.ASSETS_BUCKET.get(orphanPatchKey)).toBeNull();
  });

  it("keeps channel-current, embedded, and in-flight-rollout updates", async () => {
    for (const id of [uCurrent, uEmbedded, uRolloutPrev, uRolloutNew, uRecent]) {
      const row = await env.DB.prepare(`SELECT "id" FROM "updates" WHERE "id" = ?`)
        .bind(id)
        .first();
      expect(row, `${id} should survive`).not.toBeNull();
    }
  });

  it("keeps a shared asset still referenced by a surviving update", async () => {
    // uRecent survives and references hashS, so it is never orphaned.
    expect(await env.ASSETS_BUCKET.get(`assets/${hashS}`)).not.toBeNull();
    const row = await env.DB.prepare(`SELECT "hash" FROM "assets" WHERE "hash" = ?`)
      .bind(hashS)
      .first();
    expect(row).not.toBeNull();
  });

  it("keeps a live patch whose from/to both survive within the base window", async () => {
    // from=uEmbedded (valid base), to=uCurrent (surviving). Even with
    // patchCutoff=RECENT (everything beyond TTL), both ids reachable => KEEP.
    expect(await env.ASSETS_BUCKET.get(livePatchKey)).not.toBeNull();
    // The embedded base bundle is untouched.
    expect(
      await env.DB.prepare(`SELECT "hash" FROM "assets" WHERE "hash" = ?`)
        .bind(hashEmbedded)
        .first(),
    ).not.toBeNull();
  });

  it("keeps a within-TTL patch whose `to` was reaped (TTL guard)", async () => {
    // ttlGuardedPatchKey.to == uOldUnref (already reaped). Write it fresh: with
    // patchCutoff in the past (30 days) this just-uploaded blob is within the
    // window, so the TTL gate keeps it despite the unreachable `to`.
    await env.ASSETS_BUCKET.put(ttlGuardedPatchKey, new Uint8Array([5]));
    const kept = await run(reapPatches({ patchCutoff: PATCH_CUTOFF }));
    expect(kept.patchesDeleted).toBe(0);
    expect(await env.ASSETS_BUCKET.get(ttlGuardedPatchKey)).not.toBeNull();
  });

  it("is idempotent: a second run deletes nothing new", async () => {
    const second = await run(
      Effect.gen(function* () {
        const updates = yield* reapUpdates({ cutoff: UPDATE_CUTOFF });
        const patches = yield* reapPatches({ patchCutoff: PATCH_CUTOFF });
        return { updates, patches };
      }),
    );
    expect(second.updates.updatesDeleted).toBe(0);
    expect(second.updates.assetsDeleted).toBe(0);
    expect(second.patches.patchesDeleted).toBe(0);
  });
});

const insertOrg = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, 'Org', ?, '2020-01-01')`,
  )
    .bind(id, slug)
    .run();

const insertProject = (id: string, orgId: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at") VALUES (?, ?, 'Project', ?, '2020-01-01T00:00:00.000Z')`,
  )
    .bind(id, orgId, slug)
    .run();

const insertBranch = (id: string, projectId: string, name: string) =>
  env.DB.prepare(
    `INSERT INTO "branches" ("id", "project_id", "name", "created_at") VALUES (?, ?, ?, '2020-01-01T00:00:00.000Z')`,
  )
    .bind(id, projectId, name)
    .run();

const insertChannel = (id: string, projectId: string, branchId: string, name = "production") =>
  env.DB.prepare(
    `INSERT INTO "channels" ("id", "project_id", "name", "branch_id", "branch_mapping_json", "is_paused", "created_at") VALUES (?, ?, ?, ?, NULL, 0, '2020-01-01T00:00:00.000Z')`,
  )
    .bind(id, projectId, name, branchId)
    .run();

// P0 regression: the manifest serving layer resolves over a LIMIT-2 window
// (latest + previous) and can serve the SECOND-newest as the rollout fallback
// (evaluateFallback returns `previous` directly when there is no easClientId or
// the device is not in the latest's partial bucket). When BOTH latest and
// previous are partial rollouts, the OLD keep clauses (newest-per-tuple +
// newest-100% only) did NOT protect the previous — so a partial previous beyond
// the cutoff was wrongly reapable while still served. The fix protects the
// newest TWO per tuple (findServableUpdateIdsForBranches, rn<=2).
describe("OTA reaper: double-partial rollout fallback survives (P0)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-dp-${suffix}`;
  const branchId = `branch-dp-${suffix}`;
  const rv = "40.0.0";
  // previous: partial, OLD (beyond cutoff). latest: partial, also OLD but
  // strictly-newer id/time so it shadows previous as "newest".
  const uPrevPartial = `aaaa1111-0000-0000-0000-${suffix}00000000`;
  const uLatestPartial = `bbbb2222-0000-0000-0000-${suffix}00000000`;

  beforeAll(async () => {
    await insertOrg(`org-dp-${suffix}`, `dp-org-${suffix}`);
    await insertProject(projectId, `org-dp-${suffix}`, `dp-app-${suffix}`);
    await insertBranch(branchId, projectId, "main");
    await insertChannel(`chan-dp-${suffix}`, projectId, branchId);

    await insertAsset(`hashdp-prev-${suffix}`);
    await insertAsset(`hashdp-latest-${suffix}`);
    // previous partial rollout (50%), beyond cutoff.
    await insertUpdate({
      id: uPrevPartial,
      branchId,
      groupId: `grp-dp-prev-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: "2020-01-01T00:00:00.000Z",
      rolloutPercentage: 50,
    });
    await linkAsset(uPrevPartial, `hashdp-prev-${suffix}`, true);
    // latest partial rollout (50%), also beyond cutoff but newer => shadows prev.
    await insertUpdate({
      id: uLatestPartial,
      branchId,
      groupId: `grp-dp-latest-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: "2020-02-01T00:00:00.000Z",
      rolloutPercentage: 50,
    });
    await linkAsset(uLatestPartial, `hashdp-latest-${suffix}`, true);
  });

  it("keeps the partial previous served as the rollout fallback", async () => {
    await run(reapUpdates({ cutoff: computeCutoff(90) }));

    const prev = await env.DB.prepare(`SELECT "id" FROM "updates" WHERE "id" = ?`)
      .bind(uPrevPartial)
      .first();
    expect(prev, "partial previous is the LIMIT-2 fallback and must survive").not.toBeNull();
    const latest = await env.DB.prepare(`SELECT "id" FROM "updates" WHERE "id" = ?`)
      .bind(uLatestPartial)
      .first();
    expect(latest, "partial latest (newest per tuple) always survives").not.toBeNull();
  });
});

// P3 regression: a content-addressed asset shared by two reapable updates that
// are both deleted this run must be collected (its last referrer is gone), while
// an asset also referenced by a surviving update must be kept. The fix computes
// orphans against the GLOBAL post-reap state, not one batch.
describe("OTA reaper: global shared-asset reconciliation (P3)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-sa-${suffix}`;
  const branchId = `branch-sa-${suffix}`;
  const rv = "50.0.0";
  // Two old reapable groups + a newest survivor (shields them as not-newest).
  const uOldA = `cccc1111-0000-0000-0000-${suffix}00000000`;
  const uOldB = `dddd2222-0000-0000-0000-${suffix}00000000`;
  const uNewest = `eeee3333-0000-0000-0000-${suffix}00000000`;
  const sharedReaped = `hash-shared-reaped-${suffix}`; // only uOldA + uOldB
  const sharedSurvives = `hash-shared-survives-${suffix}`; // uOldA + uNewest

  beforeAll(async () => {
    await insertOrg(`org-sa-${suffix}`, `sa-org-${suffix}`);
    await insertProject(projectId, `org-sa-${suffix}`, `sa-app-${suffix}`);
    await insertBranch(branchId, projectId, "main");
    await insertChannel(`chan-sa-${suffix}`, projectId, branchId);

    await insertAsset(sharedReaped);
    await insertAsset(sharedSurvives);
    await env.ASSETS_BUCKET.put(`assets/${sharedReaped}`, new Uint8Array([1]));
    await env.ASSETS_BUCKET.put(`assets/${sharedSurvives}`, new Uint8Array([2]));

    // uOldA: references both the reaped-shared and the survives-shared asset.
    await insertUpdate({
      id: uOldA,
      branchId,
      groupId: `grp-sa-a-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    await linkAsset(uOldA, sharedReaped, true);
    await linkAsset(uOldA, sharedSurvives, false);
    // uOldB: references the reaped-shared asset only.
    await insertUpdate({
      id: uOldB,
      branchId,
      groupId: `grp-sa-b-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: "2020-01-02T00:00:00.000Z",
    });
    await linkAsset(uOldB, sharedReaped, true);

    // Filler launch-asset updates (newer than uOldA/uOldB) so the two fall
    // OUTSIDE the recent patch-base window (PATCH_BASE_PROTECT_LIMIT=10) and are
    // therefore reapable; without these every launch-asset update ranks in the
    // top-N base set per tuple and is protected as a current base (clause 5).
    for (let index = 0; index < 12; index += 1) {
      const fillerId = `sa-filler-${index}-${suffix}`;
      const fillerHash = `hashsa-f${index}-${suffix}`;
      await insertAsset(fillerHash);
      await insertUpdate({
        id: fillerId,
        branchId,
        groupId: `grp-sa-filler-${index}-${suffix}`,
        runtimeVersion: rv,
        platform: "ios",
        createdAt: `2021-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      });
      await linkAsset(fillerId, fillerHash, true);
    }

    // uNewest: survivor (newest per tuple) that also references survives-shared.
    await insertUpdate({
      id: uNewest,
      branchId,
      groupId: `grp-sa-new-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: "2099-01-01T00:00:00.000Z",
    });
    await linkAsset(uNewest, sharedSurvives, true);
    await insertAsset(`hashsa-new-${suffix}`);
    await linkAsset(uNewest, `hashsa-new-${suffix}`, false);
  });

  it("collects an asset whose every referrer is reaped, keeps one still referenced", async () => {
    const result = await run(reapUpdates({ cutoff: computeCutoff(90) }));
    expect(result.updatesDeleted).toBeGreaterThanOrEqual(2);

    // sharedReaped: both referrers (uOldA, uOldB) reaped => collected.
    expect(await env.ASSETS_BUCKET.get(`assets/${sharedReaped}`)).toBeNull();
    const reapedRow = await env.DB.prepare(`SELECT "hash" FROM "assets" WHERE "hash" = ?`)
      .bind(sharedReaped)
      .first();
    expect(reapedRow, "asset with no surviving referrer must be collected").toBeNull();

    // sharedSurvives: still referenced by uNewest => kept.
    expect(await env.ASSETS_BUCKET.get(`assets/${sharedSurvives}`)).not.toBeNull();
    const survivesRow = await env.DB.prepare(`SELECT "hash" FROM "assets" WHERE "hash" = ?`)
      .bind(sharedSurvives)
      .first();
    expect(survivesRow, "asset still referenced by a survivor must be kept").not.toBeNull();
  });
});

// P1 regression: D1 caps a single statement at 100 bound parameters. The keep
// set (servable rn<=2 + patch bases) easily exceeds 100 for a project with many
// tuples, and a reap batch can carry >50 update ids. The old code bound both
// into single statements and threw `too many SQL variables`, silently aborting
// the project. The fix keeps the keep set out of SQL entirely and chunks every
// id-list statement. This exercises both ceilings in one project.
describe("OTA reaper: D1 parameter ceilings (P1)", () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const projectId = `proj-pc-${suffix}`;
  const rv = "60.0.0";
  // Many branches => the keep set (servable rn<=2 + patch bases) crosses D1's
  // 100-parameter ceiling. The OLD code bound that whole set into the candidate
  // query's NOT IN and threw `too many SQL variables`.
  const branchCount = 110;
  const reapableBranch = `branch-pc-reap-${suffix}`;

  beforeAll(async () => {
    await insertOrg(`org-pc-${suffix}`, `pc-org-${suffix}`);
    await insertProject(projectId, `org-pc-${suffix}`, `pc-app-${suffix}`);

    // 60 branches each with a current update => ~60 servable keep ids; each is
    // also a launch-asset base => ~60 more base ids. Keep set > 100 total.
    for (let index = 0; index < branchCount; index += 1) {
      const branchId = `branch-pc-${index}-${suffix}`;
      await insertBranch(branchId, projectId, `b${index}`);
      await insertChannel(`chan-pc-${index}-${suffix}`, projectId, branchId, `chan-${index}`);
      const currentId = `pc-cur-${index}-${suffix.padEnd(8, "0")}`;
      const hash = `hashpc-cur-${index}-${suffix}`;
      await insertAsset(hash);
      await insertUpdate({
        id: currentId,
        branchId,
        groupId: `grp-pc-cur-${index}-${suffix}`,
        runtimeVersion: rv,
        platform: "ios",
        createdAt: "2099-01-01T00:00:00.000Z",
      });
      await linkAsset(currentId, hash, true);
    }

    // One branch with 95 OLD reapable updates (beyond IN_CHUNK=80) shielded by a
    // newest survivor, plus enough filler to push them out of the base window.
    await insertBranch(reapableBranch, projectId, "reap");
    await insertChannel(`chan-pc-reap-${suffix}`, projectId, reapableBranch, "reap");
    for (let index = 0; index < 95; index += 1) {
      const id = `pc-reap-${String(index).padStart(2, "0")}-${suffix.padEnd(8, "0")}`;
      const hash = `hashpc-reap-${index}-${suffix}`;
      await insertAsset(hash);
      await insertUpdate({
        id,
        branchId: reapableBranch,
        groupId: `grp-pc-reap-${index}-${suffix}`,
        runtimeVersion: rv,
        platform: "ios",
        createdAt: `2020-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
      await linkAsset(id, hash, true);
    }
    // Newest survivor on the reap branch (shields the 95 as not-newest).
    const survivorId = `pc-survivor-${suffix.padEnd(8, "0")}`;
    await insertAsset(`hashpc-survivor-${suffix}`);
    await insertUpdate({
      id: survivorId,
      branchId: reapableBranch,
      groupId: `grp-pc-survivor-${suffix}`,
      runtimeVersion: rv,
      platform: "ios",
      createdAt: "2099-06-01T00:00:00.000Z",
    });
    await linkAsset(survivorId, `hashpc-survivor-${suffix}`, true);
  });

  it("reaps a >IN_CHUNK batch under a >100-id keep set without a D1 variable overflow", async () => {
    // The OLD code threw `too many SQL variables` here; the fix must reap the
    // 85 oldest reapable updates (95 minus the 10 protected by the base window).
    const result = await run(reapUpdates({ cutoff: computeCutoff(90) }));
    expect(result.updatesDeleted).toBeGreaterThan(IN_CHUNK_THRESHOLD);

    // Every current/servable update on the 60 keep branches survives.
    const survivorCount = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM "updates" u JOIN "branches" b ON u."branch_id" = b."id" WHERE b."project_id" = ? AND u."created_at" >= '2099-01-01T00:00:00.000Z'`,
    )
      .bind(projectId)
      .first<{ c: number }>();
    expect(survivorCount?.c).toBe(branchCount + 1);
  });
});
