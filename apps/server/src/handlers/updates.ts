import { Conflict, NotFound } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareCtx, cloudflareEnv } from "../cloudflare/context";
import { AssetRepo } from "../repositories/assets";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";
import { PatchRepo } from "../repositories/patches";
import { ProjectRepo } from "../repositories/projects";
import { UpdateRepo } from "../repositories/updates";

const getUpdateAssets = (updateId: string) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const rows = yield* Effect.promise(async () =>
      env.DB.prepare(
        `SELECT "asset_key", "asset_hash", "is_launch" FROM "update_assets" WHERE "update_id" = ?`,
      )
        .bind(updateId)
        .all<{ asset_key: string; asset_hash: string; is_launch: number }>(),
    );
    return rows.results.map((row) => ({
      key: row.asset_key,
      hash: row.asset_hash,
      isLaunch: row.is_launch === 1,
    }));
  });

/** Find previous update's launch asset hash for a branch/platform/runtime combination */
const findPrevLaunchHash = (params: {
  readonly branchId: string;
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly excludeUpdateId: string;
}) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    return yield* Effect.promise(async () =>
      env.DB.prepare(
        `SELECT ua."asset_hash" FROM "updates" u JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 WHERE u."branch_id" = ? AND u."platform" = ? AND u."runtime_version" = ? AND u."is_rollback" = 0 AND u."id" != ? ORDER BY u."created_at" DESC, u."id" DESC LIMIT 1`,
      )
        .bind(params.branchId, params.platform, params.runtimeVersion, params.excludeUpdateId)
        .first<{ asset_hash: string }>(),
    );
  });

/** Enqueue patch generation job if a previous launch asset exists and differs */
const enqueuePatchJob = (params: {
  readonly branchId: string;
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly newUpdateId: string;
  readonly newLaunchHash: string;
}) =>
  Effect.gen(function* () {
    const env = yield* cloudflareEnv;
    const ctx = yield* cloudflareCtx;
    const prevLaunch = yield* findPrevLaunchHash({
      branchId: params.branchId,
      platform: params.platform,
      runtimeVersion: params.runtimeVersion,
      excludeUpdateId: params.newUpdateId,
    });
    if (prevLaunch && prevLaunch.asset_hash !== params.newLaunchHash) {
      ctx.waitUntil(
        env.PATCH_QUEUE.send({
          oldHash: prevLaunch.asset_hash,
          newHash: params.newLaunchHash,
        }),
      );
    }
  });

/** Clean up patches associated with a launch asset hash */
const cascadeDeletePatches = (assetHash: string) =>
  Effect.gen(function* () {
    const patchRepo = yield* PatchRepo;
    const env = yield* cloudflareEnv;
    const deletedPatches = yield* patchRepo.deleteByAssetHash({ assetHash });
    if (deletedPatches.length > 0) {
      yield* Effect.promise(async () =>
        env.ASSETS_BUCKET.delete(deletedPatches.map((patch) => patch.r2_key)),
      );
    }
  });

export const UpdatesGroupLive = HttpApiBuilder.group(ManagementApi, "updates", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("update", "create");

        // Resolve project by scope key
        const projectRepo = yield* ProjectRepo;
        const project = yield* projectRepo.findByScopeKey({ scopeKey: payload.project });
        yield* assertProjectOwnership(project.id);

        // Resolve branch by name within project
        const branchRepo = yield* BranchRepo;
        const branch = yield* branchRepo.findByProjectAndName({
          projectId: project.id,
          name: payload.branch,
        });

        // Check for active per-update rollout
        const updateRepo = yield* UpdateRepo;
        const hasActive = yield* updateRepo.hasActiveRollout({
          branchId: branch.id,
          platform: payload.platform,
          runtimeVersion: payload.runtimeVersion,
        });
        if (hasActive) {
          return yield* Effect.fail(
            new Conflict({
              message:
                "Cannot publish while a per-update rollout is active. Complete or revert the rollout first.",
            }),
          );
        }

        // Verify all asset hashes exist
        const assetRepo = yield* AssetRepo;
        const existingAssets = yield* assetRepo.findByHashes({
          hashes: payload.assets.map((asset) => asset.hash),
        });
        const existingHashes = new Set(existingAssets.map((asset) => asset.hash));
        const missingHashes = payload.assets.filter((asset) => !existingHashes.has(asset.hash));
        if (missingHashes.length > 0) {
          return yield* Effect.fail(
            new NotFound({
              message: `Assets not found: ${missingHashes.map((asset) => asset.hash).join(", ")}`,
            }),
          );
        }

        // Create update with assets
        const result = yield* updateRepo.insert({
          branchId: branch.id,
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
        });

        // Enqueue patch generation if previous update exists
        if (!(payload.isRollback ?? false)) {
          const newLaunchAsset = payload.assets.find((asset) => asset.isLaunch);
          if (newLaunchAsset) {
            yield* enqueuePatchJob({
              branchId: branch.id,
              platform: payload.platform,
              runtimeVersion: payload.runtimeVersion,
              newUpdateId: result.id,
              newLaunchHash: newLaunchAsset.hash,
            });
          }
        }

        const channelRepo = yield* ChannelRepo;
        yield* channelRepo.bumpCacheVersionByBranch({ branchId: branch.id });

        yield* logAudit({
          action: "update.create",
          resourceType: "update",
          resourceId: result.id,
          metadata: { branchId: branch.id, platform: payload.platform },
        });

        return result;
      }),
    )
    .handle("list", ({ urlParams }) =>
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

        return { items, total, page, limit };
      }),
    )
    .handle("deleteGroup", ({ path }) =>
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
              const env = yield* cloudflareEnv;
              const launchAsset = yield* Effect.promise(async () =>
                env.DB.prepare(
                  `SELECT "asset_hash" FROM "update_assets" WHERE "update_id" = ? AND "is_launch" = 1`,
                )
                  .bind(update.id)
                  .first<{ asset_hash: string }>(),
              );
              if (launchAsset) {
                yield* cascadeDeletePatches(launchAsset.asset_hash);
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
    )
    .handle("republish", ({ payload }) =>
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

        // Check for active per-update rollout on target branch
        const hasActive = yield* updateRepo.hasActiveRollout({
          branchId: targetChannel.branchId,
          platform: sourceUpdate.platform,
          runtimeVersion: sourceUpdate.runtimeVersion,
        });
        if (hasActive) {
          return yield* Effect.fail(
            new Conflict({
              message:
                "Cannot republish while a per-update rollout is active on the target branch. Complete or revert the rollout first.",
            }),
          );
        }

        // Get source update's assets via update_assets table
        const sourceAssets = yield* getUpdateAssets(sourceUpdate.id);

        const result = yield* updateRepo.insert({
          branchId: targetChannel.branchId,
          runtimeVersion: sourceUpdate.runtimeVersion,
          platform: sourceUpdate.platform,
          message: sourceUpdate.message,
          metadataJson: sourceUpdate.metadataJson,
          extraJson: sourceUpdate.extraJson,
          groupId: crypto.randomUUID(),
          rolloutPercentage: 100,
          isRollback: false,
          signature: sourceUpdate.signature,
          certificateChain: sourceUpdate.certificateChain,
          manifestBody: sourceUpdate.manifestBody,
          directiveBody: sourceUpdate.directiveBody,
          assets: sourceAssets,
        });

        // Enqueue patch generation on target branch
        const newLaunchAsset = sourceAssets.find((asset) => asset.isLaunch);
        if (newLaunchAsset) {
          yield* enqueuePatchJob({
            branchId: targetChannel.branchId,
            platform: sourceUpdate.platform,
            runtimeVersion: sourceUpdate.runtimeVersion,
            newUpdateId: result.id,
            newLaunchHash: newLaunchAsset.hash,
          });
        }

        yield* channelRepo.bumpCacheVersionByBranch({ branchId: targetChannel.branchId });

        yield* logAudit({
          action: "update.promote",
          resourceType: "update",
          resourceId: result.id,
          metadata: { channelId: payload.targetChannelId },
        });

        return result;
      }),
    )
    .handle("editRollout", ({ path, payload }) =>
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

        return yield* updateRepo.findById({ id: path.id });
      }),
    )
    .handle("completeRollout", ({ path }) =>
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

        return yield* updateRepo.findById({ id: path.id });
      }),
    )
    .handle("revertRollout", ({ path }) =>
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

        return yield* updateRepo.findById({ id: path.id });
      }),
    ),
);
