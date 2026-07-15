import { Effect } from "effect";

import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BuildRuntime } from "../cloudflare/build-runtime";
import { WorkersCache } from "../cloudflare/workers-cache";
import { updateCacheTag } from "../domain/cache-tags";
import { NotFound } from "../errors";
import { toApiBadRequestReadEffect } from "../http/to-api-effect";
import {
  BranchRepo,
  BundleRepo,
  ChannelRepo,
  DebugArtifactRepo,
  UpdateRepo,
} from "../repositories";

import type { UpdateModel } from "../models";

/**
 * Delete the update rows plus their R2 leftovers: sourcemaps (private builds
 * bucket, keyed per update) and orphaned assets. Routes the manual delete
 * through the same orphan-aware asset cleanup the OTA reaper uses, so the two
 * paths never diverge (the plain deleteGroup left assets/{hash} on R2). Only
 * assets with zero surviving referrers are removed; shared assets are kept.
 * Record referenced hashes BEFORE deleting update_assets, then test for
 * orphans AFTER (a remaining referrer is then a genuine survivor).
 */
const deleteUpdatesWithStorage = (updates: readonly UpdateModel[]) =>
  Effect.gen(function* () {
    const updateRepo = yield* UpdateRepo;
    const updateIds = updates.map((update) => update.id);
    const referencedHashes = yield* updateRepo.findAssetHashesForUpdates({ updateIds });
    // Sourcemap keys must be read BEFORE the delete (rows cascade away with
    // the updates); the objects live in the private builds bucket.
    const debugRepo = yield* DebugArtifactRepo;
    const sourcemapKeys = yield* debugRepo.listSourcemapR2KeysByUpdateIds({ updateIds });
    const { updatesDeleted } = yield* updateRepo.deleteUpdateRows({ updateIds });
    if (sourcemapKeys.length > 0) {
      const buildRuntime = yield* BuildRuntime;
      yield* buildRuntime.deleteObjects({ keys: sourcemapKeys });
    }

    const orphanHashes = yield* updateRepo.findUnreferencedAssetHashes({
      hashes: referencedHashes,
    });
    const orphanKeys = yield* updateRepo.findAssetR2KeysByHashes({ hashes: orphanHashes });

    const bundleRepo = yield* BundleRepo;
    yield* bundleRepo.deleteObjects({ keys: orphanKeys });
    yield* updateRepo.deleteAssetRows({ hashes: orphanHashes });

    return updatesDeleted;
  });

export const handleDeleteGroup = ({ path }: { readonly path: { readonly groupId: string } }) =>
  toApiBadRequestReadEffect(
    Effect.gen(function* () {
      const updateRepo = yield* UpdateRepo;
      const updates = yield* updateRepo.findByGroupId({ groupId: path.groupId });

      // Verify ownership via branch -> project
      const [firstUpdate] = updates;
      if (!firstUpdate) {
        return yield* new NotFound({ message: "Update group not found" });
      }
      const branchRepo = yield* BranchRepo;
      const branch = yield* branchRepo.findById({ id: firstUpdate.branchId });
      yield* assertProjectOwnership(branch.projectId);
      // The branch name is the environment segment (per-env grants + the
      // protected-env guard apply to destructive update removal).
      yield* assertAccess("update", "delete", {
        kind: "environment",
        projectId: branch.projectId,
        environment: branch.name,
      });

      const updatesDeleted = yield* deleteUpdatesWithStorage(updates);

      const channelRepo = yield* ChannelRepo;
      yield* channelRepo.bumpCacheVersionByBranch({ branchId: firstUpdate.branchId });

      // The cache_version bump above only rotates the INTERNAL manifest-cache
      // key; Workers Cache (in front of the Worker) keys full bundles by URL
      // and would keep serving a deleted update's bundle until TTL. Purge its
      // tags so an explicit delete actually removes the bytes from the edge.
      const workersCache = yield* WorkersCache;
      yield* workersCache.purgeTags(updates.map((update) => updateCacheTag(update.id)));

      yield* logAudit({
        action: "update.delete",
        resourceType: "update",
        resourceId: path.groupId,
        projectId: branch.projectId,
      });

      return { deleted: updatesDeleted };
    }),
  );
