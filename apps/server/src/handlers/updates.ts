import { Conflict, NotFound } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { AssetRepo } from "../repositories/assets";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";
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

        const channelRepo = yield* ChannelRepo;
        yield* channelRepo.bumpCacheVersionByBranch({ branchId: branch.id });

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

        const result = yield* updateRepo.deleteGroup({ groupId: path.groupId });

        const channelRepo = yield* ChannelRepo;
        yield* channelRepo.bumpCacheVersionByBranch({ branchId: firstUpdate.branchId });

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

        yield* channelRepo.bumpCacheVersionByBranch({ branchId: targetChannel.branchId });

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
