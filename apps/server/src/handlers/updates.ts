import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { CreateUpdateBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { UpdateCoordinator } from "../cloudflare/update-coordinator";
import { validateUpdatePublishInput } from "../domain/update-publish-validation";
import { Conflict, NotFound } from "../errors";
import { toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { AssetRepo, BranchRepo, ChannelRepo, ProjectRepo, UpdateRepo } from "../repositories";
import {
  prepareRepublishUpdates,
  resolveRepublishDestination,
  resolveRepublishSource,
} from "./update-republish";

import type { UpdateSortKey, UpdateSortOrder } from "../repositories/updates";

const parseUpdateSort = (
  value: string | undefined = "-createdAt",
): { readonly sort: UpdateSortKey; readonly order: UpdateSortOrder } => {
  const order: UpdateSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "createdAt":
    case "runtimeVersion":
    case "platform":
    case "rolloutPercentage": {
      return { sort: column, order };
    }
    default: {
      return { sort: "createdAt", order: "desc" };
    }
  }
};

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
      yield* new Conflict({
        message: `Assets not uploaded: ${pendingHashes.join(", ")}`,
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
        manifestBody: toDbNull(payload.manifestBody),
        directiveBody: toDbNull(payload.directiveBody),
      });

      const ctx = yield* CurrentActor;
      const projectRepo = yield* ProjectRepo;
      const project = yield* projectRepo.findBySlug({
        organizationId: ctx.organizationId,
        slug: payload.slug,
      });
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
          projectId: project.id,
          metadata: { name: payload.branch, projectId: project.id, source: "update.create" },
        });
      }

      if (branchValue.channelCreated) {
        yield* logAudit({
          action: "channel.create",
          resourceType: "channel",
          resourceId: branchValue.channelId,
          projectId: project.id,
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
          signature: toDbNull(payload.signature),
          certificateChain: toDbNull(payload.certificateChain),
          manifestBody: toDbNull(payload.manifestBody),
          directiveBody: toDbNull(payload.directiveBody),
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
        projectId: project.id,
        metadata: { branchId: result.branchId, platform: payload.platform },
      });

      return result;
    }),
  );

const updateRolloutPercentage = (id: string, percentage: number) =>
  Effect.gen(function* () {
    yield* assertPermission("rollout", "update");

    const updateRepo = yield* UpdateRepo;
    const update = yield* updateRepo.findById({ id });

    const branchRepo = yield* BranchRepo;
    const branch = yield* branchRepo.findById({ id: update.branchId });
    yield* assertProjectOwnership(branch.projectId);

    yield* updateRepo.updateRollout({ id, percentage });

    const channelRepo = yield* ChannelRepo;
    yield* channelRepo.bumpCacheVersionByBranch({ branchId: update.branchId });

    return toApiUpdate(yield* updateRepo.findById({ id }));
  });

export const UpdatesGroupLive = HttpApiBuilder.group(ManagementApi, "updates", (handlers) =>
  handlers
    .handle("create", handleCreateUpdate)
    .handle("list", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "read");
          yield* assertProjectOwnership(urlParams.projectId);

          const repo = yield* UpdateRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseUpdateSort(urlParams.sort);

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
            ...(urlParams.branchId ? { branchId: urlParams.branchId } : {}),
            ...(urlParams.platform ? { platform: urlParams.platform } : {}),
            sort,
            order,
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
            projectId: branch.projectId,
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
          const republishUpdates = yield* prepareRepublishUpdates({
            payload,
            sourceUpdates: source.sourceUpdates,
          });
          const coordinator = yield* UpdateCoordinator;
          const publishResult = yield* coordinator.republishUpdate({
            coordinatorName: destination.branchId,
            payload: {
              branchId: destination.branchId,
              message: toDbNull(payload.message),
              updates: republishUpdates,
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
                projectId: source.projectId,
                metadata: destination.auditMetadata,
              }),
            { concurrency: "unbounded" },
          );

          return result;
        }),
      ),
    )
    .handle("editRollout", ({ path, payload }) =>
      toApiBadRequestReadEffect(updateRolloutPercentage(path.id, payload.percentage)),
    )
    .handle("completeRollout", ({ path }) =>
      toApiBadRequestReadEffect(updateRolloutPercentage(path.id, 100)),
    )
    .handle("revertRollout", ({ path }) =>
      toApiBadRequestReadEffect(updateRolloutPercentage(path.id, 0)),
    ),
);
