import { DEFAULT_PATCH_BASE_WINDOW } from "@better-update/expo-protocol";
import { Effect } from "effect";
import { chunk, sum } from "es-toolkit";

import { GC_BATCH_SIZE } from "../domain/gc-utils";
import { isPatchReapEligible } from "../domain/ota-reaper";
import { parsePatchKey } from "../lib/patch-key";
import {
  BuildStorageRepo,
  BundleRepo,
  ChannelRepo,
  DebugArtifactRepo,
  ProjectRepo,
  UpdateRepo,
} from "../repositories";

// OTA retention GC — multi-repo orchestration (Effect.gen, yields repositories/
// ports only; no cloudflare/ concrete adapters, no env.* direct access). Two
// composable programs the scheduled handler runs in sequence.
//
//   reapUpdates  — delete update rows + their orphaned R2 assets + their
//                  private-bucket sourcemaps beyond the UPDATE_RETENTION
//                  window, honoring the safety invariant.
//   reapPatches  — sweep ASSETS_BUCKET `patches/` for orphaned/stale bsdiff
//                  blobs (no D1 row) beyond the PATCH_RETENTION window.
//
// reapUpdates MUST run before reapPatches so the patch sweep's surviving-update
// set reflects this run's deletions.

// Protect at least the publish DEFAULT patch-base window of recent bases per
// tuple from update reaping (clause 5). Sourced from the shared
// @better-update/expo-protocol constant the CLI's `--patch-base-window` default
// also uses, so the two can never drift. NOTE: `--patch-base-window` is a
// per-publish CLI flag, not persisted server-side, so a project that publishes
// with a LARGER window may have bases beyond this limit reaped once past
// PATCH_RETENTION — those patches degrade to a full-bundle fallback and are
// regenerable, so this is an accepted, conservative bound (see the constant's
// doc comment).
const PATCH_BASE_PROTECT_LIMIT = DEFAULT_PATCH_BASE_WINDOW;

export interface ReapUpdatesResult {
  readonly updatesDeleted: number;
  readonly assetsDeleted: number;
  /** How many projects this invocation actually iterated (P4 observability). */
  readonly projectsProcessed: number;
}

export interface ReapPatchesResult {
  readonly patchesDeleted: number;
  /** How many projects this invocation actually iterated (P4 observability). */
  readonly projectsProcessed: number;
}

interface ReapUpdatesAccumulator {
  readonly updatesDeleted: number;
  readonly assetsDeleted: number;
}

/**
 * Compute the keep-id guard for a project: the manifest-servable updates
 * (channel-current / reachable-branch newest TWO per tuple — the serving layer's
 * LIMIT-2 rollout-fallback window) UNION current patch-base ids. These ids are
 * filtered out of the reap candidates in JS (NOT bound into SQL — the set can
 * grow without bound and must never hit D1's parameter ceiling).
 */
const collectProjectKeepIds = (projectId: string) =>
  Effect.gen(function* () {
    const channelRepo = yield* ChannelRepo;
    const updateRepo = yield* UpdateRepo;

    const reachableBranchIds = yield* channelRepo.listReachableBranchIdsByProject({ projectId });
    const servableIds = yield* updateRepo.findServableUpdateIdsForBranches({
      branchIds: reachableBranchIds,
    });
    const patchBaseIds = yield* updateRepo.findPatchBaseUpdateIdsByProject({
      projectId,
      limit: PATCH_BASE_PROTECT_LIMIT,
    });

    return new Set([...servableIds, ...patchBaseIds]);
  });

/**
 * (A) Reap updates older than `cutoff`. Per project: compute the keep-id guard,
 * then loop reap-eligible batches — collect group-atomic reapIds (minus the keep
 * guard), record the asset hashes they reference, and delete their update +
 * update_assets rows. AFTER all batches, reconcile orphan assets across the
 * WHOLE run: of every hash referenced by a reaped update, delete the R2 object +
 * assets row for those with no surviving referrer (global, so a shared asset
 * spread across batches is never wrongly kept AND never wrongly deleted).
 */
export const reapUpdates = (params: { readonly cutoff: string }) =>
  Effect.gen(function* () {
    const projectRepo = yield* ProjectRepo;
    const projectIds = yield* projectRepo.listAllIds();

    const perProject = yield* Effect.forEach(
      projectIds,
      (projectId) =>
        Effect.gen(function* () {
          const keepUpdateIds = yield* collectProjectKeepIds(projectId);
          return yield* reapProjectUpdates({ projectId, cutoff: params.cutoff, keepUpdateIds });
        }),
      { concurrency: 1 },
    );

    const totals = perProject.reduce<ReapUpdatesAccumulator>(
      (acc, result) => ({
        updatesDeleted: acc.updatesDeleted + result.updatesDeleted,
        assetsDeleted: acc.assetsDeleted + result.assetsDeleted,
      }),
      { updatesDeleted: 0, assetsDeleted: 0 },
    );

    return { ...totals, projectsProcessed: projectIds.length } satisfies ReapUpdatesResult;
  });

interface ReapLoopState {
  readonly hasMore: boolean;
  readonly updatesDeleted: number;
  readonly referencedHashes: ReadonlySet<string>;
}

const reapProjectUpdates = (params: {
  readonly projectId: string;
  readonly cutoff: string;
  readonly keepUpdateIds: ReadonlySet<string>;
}) =>
  Effect.gen(function* () {
    const initial: ReapLoopState = {
      hasMore: true,
      updatesDeleted: 0,
      referencedHashes: new Set<string>(),
    };
    const loop = yield* Effect.iterate(initial, {
      while: (state) => state.hasMore,
      body: (state) => reapOneBatch(params, state),
    });

    // GLOBAL orphan reconciliation (P3): all reaped updates' update_assets rows
    // are now deleted, so of every hash they referenced, the unreferenced subset
    // is the run's true orphan set — no cross-batch / cross-group shared-asset
    // leak, and still keep-when-in-doubt (a surviving referrer keeps the asset).
    const orphanHashes = yield* (yield* UpdateRepo).findUnreferencedAssetHashes({
      hashes: [...loop.referencedHashes],
    });
    const updateRepo = yield* UpdateRepo;
    const orphanKeys = yield* updateRepo.findAssetR2KeysByHashes({ hashes: orphanHashes });

    const bundleRepo = yield* BundleRepo;
    yield* bundleRepo.deleteObjects({ keys: orphanKeys });
    yield* updateRepo.deleteAssetRows({ hashes: orphanHashes });

    return {
      updatesDeleted: loop.updatesDeleted,
      assetsDeleted: orphanHashes.length,
    } satisfies ReapUpdatesAccumulator;
  });

const reapOneBatch = (
  params: {
    readonly projectId: string;
    readonly cutoff: string;
    readonly keepUpdateIds: ReadonlySet<string>;
  },
  state: ReapLoopState,
) =>
  Effect.gen(function* () {
    const updateRepo = yield* UpdateRepo;
    const candidates = yield* updateRepo.findReapableUpdateBatch({
      projectId: params.projectId,
      cutoff: params.cutoff,
      limit: GC_BATCH_SIZE,
    });

    // KEEP-ID GUARD in JS (NOT bound into SQL): drop any candidate that is a
    // served / reachable-branch / current-base id. Applied here so the keep set
    // never hits D1's parameter ceiling.
    const guarded = candidates.filter((row) => !params.keepUpdateIds.has(row.id));

    if (guarded.length === 0) {
      // Either no candidates at all, or the whole page was keep-guarded; either
      // way there is nothing more this loop can make progress on.
      return { ...state, hasMore: false } satisfies ReapLoopState;
    }

    // GROUP ATOMICITY: expand candidates to whole groups, then drop any group
    // where NOT every member is itself a (guarded) reap candidate — never orphan
    // one platform of a co-published group.
    const candidateIds = new Set(guarded.map((row) => row.id));
    const groupIds = [...new Set(guarded.map((row) => row.groupId))];

    const groupMembers = yield* Effect.forEach(
      groupIds,
      (groupId) => updateRepo.findByGroupId({ groupId }),
      { concurrency: 1 },
    );

    const reapIds = groupMembers
      .filter((members) => members.every((member) => candidateIds.has(member.id)))
      .flatMap((members) => members.map((member) => member.id));

    if (reapIds.length === 0) {
      // Every candidate group had a surviving member; nothing safe to reap.
      return { ...state, hasMore: false } satisfies ReapLoopState;
    }

    // Record the asset hashes these updates reference BEFORE deleting their
    // update_assets rows, so the post-loop orphan reconciliation can test them.
    const batchHashes = yield* updateRepo.findAssetHashesForUpdates({ updateIds: reapIds });
    // Sourcemap keys must also be read BEFORE the delete (update_sourcemaps
    // rows cascade away with the updates). The objects are per-update in the
    // private builds bucket — never shared — so unlike assets they can be
    // deleted right after the rows, with no orphan reconciliation.
    const debugRepo = yield* DebugArtifactRepo;
    const sourcemapKeys = yield* debugRepo.listSourcemapR2KeysByUpdateIds({ updateIds: reapIds });
    const { updatesDeleted } = yield* updateRepo.deleteUpdateRows({ updateIds: reapIds });
    const buildStorageRepo = yield* BuildStorageRepo;
    yield* buildStorageRepo.deleteObjects({ keys: sourcemapKeys });

    return {
      // Keep looping only if this batch fully consumed the candidate page; a
      // partial drop (group safety or keep guard) means remaining candidates are
      // stuck behind surviving siblings, so stop to avoid an infinite loop.
      hasMore: reapIds.length === candidates.length,
      updatesDeleted: state.updatesDeleted + updatesDeleted,
      referencedHashes: new Set([...state.referencedHashes, ...batchHashes]),
    } satisfies ReapLoopState;
  });

/**
 * (B) Sweep stale/orphaned bsdiff patch blobs beyond `patchCutoff`. Patches have
 * no D1 row, so enumerate `patches/{projectId}/` and cross-reference each key's
 * parsed (from, to) against the post-reap surviving-update set and the current
 * patch-base set. Conservative: KEEP within TTL; reap only on unambiguous
 * absence. Runs AFTER reapUpdates so survivors reflect this run's deletions.
 */
export const reapPatches = (params: { readonly patchCutoff: string }) =>
  Effect.gen(function* () {
    const projectRepo = yield* ProjectRepo;
    const projectIds = yield* projectRepo.listAllIds();

    const perProject = yield* Effect.forEach(
      projectIds,
      (projectId) => reapProjectPatches({ projectId, patchCutoff: params.patchCutoff }),
      { concurrency: 1 },
    );

    return {
      patchesDeleted: sum(perProject),
      projectsProcessed: projectIds.length,
    } satisfies ReapPatchesResult;
  });

const reapProjectPatches = (params: { readonly projectId: string; readonly patchCutoff: string }) =>
  Effect.gen(function* () {
    const updateRepo = yield* UpdateRepo;

    // Survivors + valid bases at PROJECT scope (the patch key carries no branch
    // segment, so resolve survivors/bases across the whole project; only reap on
    // unambiguous absence). Ids are lowercased to match the on-disk key.
    const survivingIds = yield* updateRepo.findSurvivingUpdateIdsByProject({
      projectId: params.projectId,
    });
    const baseIds = yield* updateRepo.findPatchBaseUpdateIdsByProject({
      projectId: params.projectId,
      limit: PATCH_BASE_PROTECT_LIMIT,
    });
    const survivingSet = new Set(survivingIds.map((id) => id.toLowerCase()));
    const baseSet = new Set(baseIds.map((id) => id.toLowerCase()));

    return yield* sweepPatchPrefix({
      prefix: `patches/${params.projectId}/`,
      patchCutoff: params.patchCutoff,
      survivingSet,
      baseSet,
    });
  });

const sweepPatchPrefix = (params: {
  readonly prefix: string;
  readonly patchCutoff: string;
  readonly survivingSet: ReadonlySet<string>;
  readonly baseSet: ReadonlySet<string>;
}) =>
  Effect.iterate(
    { cursor: undefined as string | undefined, hasMore: true, patchesDeleted: 0 },
    {
      while: (state) => state.hasMore,
      body: (state) =>
        Effect.gen(function* () {
          const bundleRepo = yield* BundleRepo;
          const listed = yield* bundleRepo.listObjects(
            state.cursor === undefined
              ? { prefix: params.prefix }
              : { prefix: params.prefix, cursor: state.cursor },
          );

          const eligibleKeys = listed.objects
            .filter((object) => {
              const parsed = parsePatchKey(object.key);
              return isPatchReapEligible({
                uploadedAt: object.uploaded.toISOString(),
                parsed,
                // A malformed key (parsed === null) is treated as junk by the
                // predicate; the cross-ref flags below are only consulted when
                // parsed is non-null.
                toSurvives: parsed !== null && params.survivingSet.has(parsed.toUpdateId),
                fromSurvives: parsed !== null && params.survivingSet.has(parsed.fromUpdateId),
                fromIsValidBase: parsed !== null && params.baseSet.has(parsed.fromUpdateId),
                cutoff: params.patchCutoff,
              });
            })
            .map((object) => object.key);

          yield* deleteInChunks(eligibleKeys);

          return {
            cursor: listed.cursor,
            hasMore: listed.truncated,
            patchesDeleted: state.patchesDeleted + eligibleKeys.length,
          };
        }),
    },
  ).pipe(Effect.map((state) => state.patchesDeleted));

const deleteInChunks = (keys: readonly string[]) =>
  Effect.gen(function* () {
    if (keys.length === 0) {
      return;
    }
    const bundleRepo = yield* BundleRepo;
    yield* Effect.forEach(
      chunk([...keys], GC_BATCH_SIZE),
      (batch) => bundleRepo.deleteObjects({ keys: batch }),
      { concurrency: 1 },
    );
  });
