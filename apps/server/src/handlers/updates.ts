import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { CreateUpdateBody, RepublishBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { UpdateCoordinator } from "../cloudflare/update-coordinator";
import { validateUpdatePublishInput } from "../domain/update-publish-validation";
import { BadRequest, Conflict, NotFound } from "../errors";
import { toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { AssetRepo, BranchRepo, ChannelRepo, ProjectRepo, UpdateRepo } from "../repositories";

const getUpdateAssets = (updateId: string) =>
  Effect.gen(function* () {
    const repo = yield* UpdateRepo;
    return yield* repo.findAssetsByUpdateId({ updateId });
  });

const assertAssetsExist = (assets: readonly { readonly hash: string }[]) =>
  Effect.gen(function* () {
    const assetRepo = yield* AssetRepo;
    const existingAssets = yield* assetRepo.findByHashes({
      hashes: assets.map((asset) => asset.hash),
    });
    const existingHashes = new Set(existingAssets.map((asset) => asset.hash));
    const missingHashes = assets.filter((asset) => !existingHashes.has(asset.hash));
    const pendingHashes = existingAssets
      .filter((asset) => asset.byteSize <= 0)
      .map((asset) => asset.hash);

    if (missingHashes.length > 0) {
      yield* new NotFound({
        message: `Assets not found: ${missingHashes.map((asset) => asset.hash).join(", ")}`,
      });
    }

    if (pendingHashes.length > 0) {
      yield* new NotFound({
        message: `Assets not uploaded: ${pendingHashes.join(", ")}`,
      });
    }
  });

const fail = (message: string) => new BadRequest({ message });

const assertExactlyOneDefined = (params: {
  readonly values: readonly [unknown, unknown];
  readonly message: string;
}) => {
  const definedCount = params.values.filter((value) => value !== undefined).length;
  return definedCount === 1 ? Effect.void : Effect.fail(fail(params.message));
};

const isSignedOrPrecomputedUpdate = (update: {
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
}) =>
  update.signature !== null ||
  update.certificateChain !== null ||
  update.manifestBody !== null ||
  update.directiveBody !== null;

const resolveRepublishSource = ({ payload }: { readonly payload: typeof RepublishBody.Type }) =>
  Effect.gen(function* () {
    yield* assertExactlyOneDefined({
      values: [payload.sourceUpdateId, payload.sourceGroupId],
      message: "Provide exactly one of sourceUpdateId or sourceGroupId",
    });

    const updateRepo = yield* UpdateRepo;
    const branchRepo = yield* BranchRepo;
    const sourceUpdates = payload.sourceUpdateId
      ? [yield* updateRepo.findById({ id: payload.sourceUpdateId })]
      : yield* Effect.gen(function* () {
          const updates = yield* updateRepo.findByGroupId({
            groupId: payload.sourceGroupId ?? "",
          });
          if (updates.length === 0) {
            yield* new NotFound({ message: "Update group not found" });
          }
          return updates;
        });

    const sourceBranches = yield* Effect.forEach(
      sourceUpdates,
      (update) => branchRepo.findById({ id: update.branchId }),
      { concurrency: "unbounded" },
    );
    const projectIds = [...new Set(sourceBranches.map((branch) => branch.projectId))];
    const [sourceProjectId = ""] = projectIds;
    if (sourceProjectId.length === 0 || projectIds.length !== 1) {
      yield* fail("All source updates must belong to the same project");
    }

    yield* assertProjectOwnership(sourceProjectId);

    if (sourceUpdates.some((update) => update.isRollback)) {
      yield* fail("Cannot republish a rollback directive");
    }

    if (sourceUpdates.some(isSignedOrPrecomputedUpdate)) {
      yield* fail(
        "Cannot republish in a signed project. Use POST /api/updates with a pre-signed manifest instead.",
      );
    }

    const sourceUpdatesWithAssets = yield* Effect.forEach(
      sourceUpdates,
      (update) =>
        Effect.map(getUpdateAssets(update.id), (assets) => ({
          update,
          assets,
        })),
      { concurrency: "unbounded" },
    );

    return {
      projectId: sourceProjectId,
      sourceUpdates: sourceUpdatesWithAssets.toSorted((left, right) =>
        left.update.platform.localeCompare(right.update.platform),
      ),
    };
  });

const resolveRepublishDestination = (params: {
  readonly payload: typeof RepublishBody.Type;
  readonly projectId: string;
}) =>
  Effect.gen(function* () {
    yield* assertExactlyOneDefined({
      values: [params.payload.destinationBranchId, params.payload.destinationChannel],
      message: "Provide exactly one of destinationBranchId or destinationChannel",
    });

    const branchRepo = yield* BranchRepo;
    const channelRepo = yield* ChannelRepo;

    if (params.payload.destinationBranchId) {
      const destinationBranch = yield* branchRepo.findById({
        id: params.payload.destinationBranchId,
      });
      if (destinationBranch.projectId !== params.projectId) {
        yield* fail("Source and destination must belong to the same project");
      }

      return {
        branchId: destinationBranch.id,
        auditMetadata: { destinationBranchId: destinationBranch.id },
      };
    }

    const destinationChannel = yield* channelRepo.findByProjectAndName({
      projectId: params.projectId,
      name: params.payload.destinationChannel ?? "",
    });

    return {
      branchId: destinationChannel.branchId,
      auditMetadata: {
        destinationBranchId: destinationChannel.branchId,
        destinationChannel: destinationChannel.name,
      },
    };
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

          const source = yield* resolveRepublishSource({ payload });
          const destination = yield* resolveRepublishDestination({
            payload,
            projectId: source.projectId,
          });
          const coordinator = yield* UpdateCoordinator;
          const publishResult = yield* coordinator.republishUpdate({
            coordinatorName: destination.branchId,
            payload: {
              branchId: destination.branchId,
              message: payload.message ?? null,
              updates: source.sourceUpdates.map(({ update, assets }) => ({
                runtimeVersion: update.runtimeVersion,
                platform: update.platform,
                message: update.message,
                metadataJson: update.metadataJson,
                extraJson: update.extraJson,
                assets,
              })),
            },
          });
          if (!publishResult.ok) {
            return yield* Effect.fail(new Conflict({ message: publishResult.message }));
          }

          const result = {
            updates: publishResult.value.map(toApiUpdate),
          };

          yield* Effect.forEach(
            result.updates,
            (update) =>
              logAudit({
                action: "update.promote",
                resourceType: "update",
                resourceId: update.id,
                metadata: destination.auditMetadata,
              }),
            { concurrency: "unbounded" },
          );

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
