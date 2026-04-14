import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { CreateUpdateBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { AssetStorage } from "../cloudflare/asset-storage";
import { UpdateCoordinator } from "../cloudflare/update-coordinator";
import { validateUpdatePublishInput } from "../domain/update-publish-validation";
import { Conflict, NotFound } from "../errors";
import { toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import {
  AssetRepo,
  BranchRepo,
  ChannelRepo,
  PatchRepo,
  ProjectRepo,
  UpdateRepo,
} from "../repositories";

const getUpdateAssets = (updateId: string) =>
  Effect.gen(function* () {
    const repo = yield* UpdateRepo;
    return yield* repo.findAssetsByUpdateId({ updateId });
  });

/** Clean up patches associated with a launch asset hash */
const cascadeDeletePatches = (assetHash: string) =>
  Effect.gen(function* () {
    const patchRepo = yield* PatchRepo;
    const storage = yield* AssetStorage;
    const deletedPatches = yield* patchRepo.deleteByAssetHash({ assetHash });
    if (deletedPatches.length > 0) {
      yield* storage.deleteObjects({ keys: deletedPatches.map((patch) => patch.r2_key) });
    }
  });

const assertAssetsExist = (assets: readonly { readonly hash: string }[]) =>
  Effect.gen(function* () {
    const assetRepo = yield* AssetRepo;
    const existingAssets = yield* assetRepo.findByHashes({
      hashes: assets.map((asset) => asset.hash),
    });
    const existingHashes = new Set(existingAssets.map((asset) => asset.hash));
    const missingHashes = assets.filter((asset) => !existingHashes.has(asset.hash));

    if (missingHashes.length > 0) {
      yield* new NotFound({
        message: `Assets not found: ${missingHashes.map((asset) => asset.hash).join(", ")}`,
      });
    }
  });

const handleCreateUpdate = ({ payload }: { readonly payload: typeof CreateUpdateBody.Type }) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      yield* assertPermission("update", "create");

      yield* validateUpdatePublishInput({
        runtimeVersion: payload.runtimeVersion,
        assets: payload.assets,
        extra: payload.extra,
        isRollback: payload.isRollback ?? false,
        manifestBody: payload.manifestBody ?? null,
        directiveBody: payload.directiveBody ?? null,
      });

      const projectRepo = yield* ProjectRepo;
      const project = yield* projectRepo.findByScopeKey({ scopeKey: payload.project });
      yield* assertProjectOwnership(project.id);

      yield* assertAssetsExist(payload.assets);

      const coordinator = yield* UpdateCoordinator;
      const branchResult = yield* coordinator.ensureBranchChannel({
        projectId: project.id,
        branchName: payload.branch,
      });
      if (!branchResult.ok) {
        return yield* Effect.fail(new Conflict({ message: branchResult.message }));
      }
      const branchValue = branchResult.value;

      if (branchValue.branchCreated) {
        yield* logAudit({
          action: "branch.create",
          resourceType: "branch",
          resourceId: branchValue.branchId,
          metadata: { name: payload.branch, projectId: project.id, source: "update.create" },
        });
      }

      if (branchValue.channelCreated) {
        yield* logAudit({
          action: "channel.create",
          resourceType: "channel",
          resourceId: branchValue.channelId,
          metadata: { name: payload.branch, projectId: project.id, source: "update.create" },
        });
      }

      const publishResult = yield* coordinator.createUpdate({
        coordinatorName: branchValue.branchId,
        payload: {
          branchId: branchValue.branchId,
          runtimeVersion: payload.runtimeVersion,
          platform: payload.platform,
          message: payload.message,
          metadataJson: JSON.stringify(payload.metadata),
          extraJson: payload.extra ? JSON.stringify(payload.extra) : null,
          groupId: payload.groupId,
          rolloutPercentage: payload.rolloutPercentage ?? 100,
          isRollback: payload.isRollback ?? false,
          signature: payload.signature ?? null,
          certificateChain: payload.certificateChain ?? null,
          manifestBody: payload.manifestBody ?? null,
          directiveBody: payload.directiveBody ?? null,
          assets: payload.assets,
        },
      });
      if (!publishResult.ok) {
        return yield* Effect.fail(new Conflict({ message: publishResult.message }));
      }
      const publishedUpdate = publishResult.value;

      const result = toApiUpdate(publishedUpdate);

      yield* logAudit({
        action: "update.create",
        resourceType: "update",
        resourceId: result.id,
        metadata: { branchId: result.branchId, platform: payload.platform },
      });

      return result;
    }),
  );

export const UpdatesGroupLive = HttpApiBuilder.group(ManagementApi, "updates", (handlers) =>
  handlers
    .handle("create", handleCreateUpdate)
    .handle("list", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "read");
          yield* assertProjectOwnership(urlParams.projectId);

          const repo = yield* UpdateRepo;
          const page = urlParams.page ?? 1;
          const limit = urlParams.limit ?? 20;
          const offset = (page - 1) * limit;

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
            ...(urlParams.branchId ? { branchId: urlParams.branchId } : {}),
            limit,
            offset,
          });

          return { items: items.map(toApiUpdate), total, page, limit };
        }),
      ),
    )
    .handle("deleteGroup", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "delete");

          const updateRepo = yield* UpdateRepo;
          const updates = yield* updateRepo.findByGroupId({ groupId: path.groupId });
          if (updates.length === 0) {
            return yield* Effect.fail(new NotFound({ message: "Update group not found" }));
          }

          // Verify ownership via branch -> project
          const branchRepo = yield* BranchRepo;
          const [firstUpdate] = updates;
          if (!firstUpdate) {
            return yield* Effect.fail(new NotFound({ message: "Update group not found" }));
          }
          const branch = yield* branchRepo.findById({ id: firstUpdate.branchId });
          yield* assertProjectOwnership(branch.projectId);

          // Clean up associated patches before deleting updates
          yield* Effect.forEach(
            updates,
            (update) =>
              Effect.gen(function* () {
                const launchAssetHash = yield* updateRepo.findLaunchAssetHashByUpdateId({
                  updateId: update.id,
                });
                if (launchAssetHash) {
                  yield* cascadeDeletePatches(launchAssetHash);
                }
              }),
            { concurrency: 1 },
          );

          const result = yield* updateRepo.deleteGroup({ groupId: path.groupId });

          const channelRepo = yield* ChannelRepo;
          yield* channelRepo.bumpCacheVersionByBranch({ branchId: firstUpdate.branchId });

          yield* logAudit({
            action: "update.delete",
            resourceType: "update",
            resourceId: path.groupId,
          });

          return result;
        }),
      ),
    )
    .handle("republish", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "create");

          // Find source update and verify ownership
          const updateRepo = yield* UpdateRepo;
          const sourceUpdate = yield* updateRepo.findById({ id: payload.sourceUpdateId });

          const branchRepo = yield* BranchRepo;
          const sourceBranch = yield* branchRepo.findById({ id: sourceUpdate.branchId });
          yield* assertProjectOwnership(sourceBranch.projectId);

          // Find target channel and get its branch
          const channelRepo = yield* ChannelRepo;
          const targetChannel = yield* channelRepo.findById({ id: payload.targetChannelId });

          // Verify target channel belongs to same project
          if (targetChannel.projectId !== sourceBranch.projectId) {
            return yield* Effect.fail(new NotFound({ message: "Target channel not found" }));
          }

          // Get source update's assets via update_assets table
          const sourceAssets = yield* getUpdateAssets(sourceUpdate.id);
          const coordinator = yield* UpdateCoordinator;
          const publishResult = yield* coordinator.republishUpdate({
            coordinatorName: targetChannel.branchId,
            payload: {
              branchId: targetChannel.branchId,
              runtimeVersion: sourceUpdate.runtimeVersion,
              platform: sourceUpdate.platform,
              message: sourceUpdate.message,
              metadataJson: sourceUpdate.metadataJson,
              extraJson: sourceUpdate.extraJson,
              signature: sourceUpdate.signature,
              certificateChain: sourceUpdate.certificateChain,
              manifestBody: sourceUpdate.manifestBody,
              directiveBody: sourceUpdate.directiveBody,
              assets: sourceAssets,
            },
          });
          if (!publishResult.ok) {
            return yield* Effect.fail(new Conflict({ message: publishResult.message }));
          }
          const republishedUpdate = publishResult.value;

          const result = toApiUpdate(republishedUpdate);

          yield* logAudit({
            action: "update.promote",
            resourceType: "update",
            resourceId: result.id,
            metadata: { channelId: payload.targetChannelId },
          });

          return result;
        }),
      ),
    )
    .handle("editRollout", ({ path, payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "update");

          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);

          yield* updateRepo.updateRollout({ id: path.id, percentage: payload.percentage });

          const channelRepo = yield* ChannelRepo;
          yield* channelRepo.bumpCacheVersionByBranch({ branchId: update.branchId });

          return toApiUpdate(yield* updateRepo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("completeRollout", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "update");

          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);

          yield* updateRepo.updateRollout({ id: path.id, percentage: 100 });

          const channelRepo = yield* ChannelRepo;
          yield* channelRepo.bumpCacheVersionByBranch({ branchId: update.branchId });

          return toApiUpdate(yield* updateRepo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("revertRollout", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "update");

          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);

          yield* updateRepo.updateRollout({ id: path.id, percentage: 0 });

          const channelRepo = yield* ChannelRepo;
          yield* channelRepo.bumpCacheVersionByBranch({ branchId: update.branchId });

          return toApiUpdate(yield* updateRepo.findById({ id: path.id }));
        }),
      ),
    ),
);
