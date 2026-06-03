import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { CreateUpdateBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { assertPermissionOn } from "../auth/scope";
import { UpdateCoordinator } from "../cloudflare/update-coordinator";
import { validateEmbeddedBaselineId } from "../domain/embedded-baseline-validation";
import { verifySignedUpdate } from "../domain/signed-update-verification";
import { validateUpdatePublishInput } from "../domain/update-publish-validation";
import { BadRequest, Conflict, NotFound } from "../errors";
import { toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toApiPatchBaseCandidate } from "../http/to-api-patch";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import {
  AssetRepo,
  BranchRepo,
  BundleRepo,
  ChannelRepo,
  ProjectRepo,
  UpdateRepo,
} from "../repositories";
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

const DEFAULT_PATCH_BASE_LIMIT = 10;
const MAX_PATCH_BASE_LIMIT = 50;

const clampPatchBaseLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_PATCH_BASE_LIMIT;
  }
  return Math.min(Math.trunc(limit), MAX_PATCH_BASE_LIMIT);
};

const resolvePatchBaseBranchId = (params: {
  readonly projectId: string;
  readonly branchId: string | undefined;
  readonly channel: string | undefined;
}) =>
  Effect.gen(function* () {
    if (params.branchId !== undefined) {
      return params.branchId;
    }
    if (params.channel === undefined) {
      return yield* Effect.fail(
        new BadRequest({ message: "Either branchId or channel is required" }),
      );
    }
    const channelRepo = yield* ChannelRepo;
    const channel = yield* channelRepo.findByProjectAndName({
      projectId: params.projectId,
      name: params.channel,
    });
    return channel.branchId;
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
      yield* new Conflict({
        message: `Assets not uploaded: ${pendingHashes.join(", ")}`,
      });
    }
  });
const handleCreateUpdate = ({ payload }: { readonly payload: typeof CreateUpdateBody.Type }) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      // NOTE: the publish gate is per-channel (assertPermissionOn) and runs AFTER
      // `ensureBranchChannel` resolves the destination channel scope below — not
      // here. Everything before that gate is read-only validation plus the
      // channel-ensure itself, so no update write happens before it.

      // Embedded-baseline id gate (trust boundary, id+isEmbedded correlated only
      // here): when isEmbedded:true the id is REQUIRED + lowercase-UUID-validated
      // so the baseline row id equals the binary's app.manifest UUID. Non-embedded
      // creates are a no-op (the render-then-sign id keeps flowing). Ownership is
      // still gated below via assertProjectOwnership before any write, so a
      // client-pinned id can only land under a project the caller owns.
      yield* validateEmbeddedBaselineId({
        id: payload.id,
        isEmbedded: payload.isEmbedded ?? false,
      });

      yield* validateUpdatePublishInput({
        runtimeVersion: payload.runtimeVersion,
        assets: payload.assets,
        extra: payload.extra,
        isRollback: payload.isRollback ?? false,
        manifestBody: toDbNull(payload.manifestBody),
        directiveBody: toDbNull(payload.directiveBody),
      });

      // SECURITY GATE: when a signature is present, verify it against the
      // certificate over the EXACT manifest/directive body bytes before any
      // write. An unverifiable or wrong-alg (e.g. ECDSA) signed update is
      // rejected with BadRequest (→ 400) and is NEVER stored or served. Runs for
      // both the render+sign path and the file-input escape hatch (same fields).
      yield* verifySignedUpdate({
        signature: toDbNull(payload.signature),
        certificateChain: toDbNull(payload.certificateChain),
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

      // Per-channel publish gate: now that the destination channel is resolved,
      // enforce update:create on THIS channel (allow/deny grants apply). Runs
      // before any update write.
      yield* assertPermissionOn("update", "create", {
        scopeKind: "channel",
        scopeId: branchValue.channelId,
      });

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
          // Honour the client-chosen id (signed renders bind to it); absent on
          // the unsigned path so the server generates one.
          ...(payload.id === undefined ? {} : { id: payload.id }),
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
          fingerprintHash: toDbNull(payload.fingerprintHash),
          // Git provenance: persist the commit + dirty flag the CLI read at
          // publish time (mirrors EAS + the builds path). Sent ALWAYS when git
          // is readable; absent on a non-git project -> NULL commit, clean tree.
          gitCommit: toDbNull(payload.gitCommit),
          gitDirty: payload.gitDirty ?? false,
          assets: payload.assets,
          isEmbedded: payload.isEmbedded ?? false,
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
    const updateRepo = yield* UpdateRepo;
    const update = yield* updateRepo.findById({ id });

    const branchRepo = yield* BranchRepo;
    const branch = yield* branchRepo.findById({ id: update.branchId });
    yield* assertProjectOwnership(branch.projectId);

    // Per-channel rollout gate: gate on the owning channel's scope (oldest first
    // if several map the branch); fall back to the org-wide baseline when no
    // channel maps the branch.
    const channelRepoForGate = yield* ChannelRepo;
    const owningChannel = yield* channelRepoForGate.findByBranchId({ branchId: update.branchId });
    yield* owningChannel
      ? assertPermissionOn("rollout", "update", { scopeKind: "channel", scopeId: owningChannel.id })
      : assertPermission("rollout", "update");

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
            ...(urlParams.runtimeVersion ? { runtimeVersion: urlParams.runtimeVersion } : {}),
            sort,
            order,
            limit,
            offset,
          });

          return { items: items.map(toApiUpdate), total, page, limit };
        }),
      ),
    )
    .handle("listPatchBases", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "read");
          yield* assertProjectOwnership(urlParams.projectId);

          const branchId = yield* resolvePatchBaseBranchId({
            projectId: urlParams.projectId,
            branchId: urlParams.branchId,
            channel: urlParams.channel,
          });

          const repo = yield* UpdateRepo;
          const rows = yield* repo.listPatchBases({
            projectId: urlParams.projectId,
            branchId,
            runtimeVersion: urlParams.runtimeVersion,
            platform: urlParams.platform,
            limit: clampPatchBaseLimit(urlParams.limit),
          });
          return rows.map(toApiPatchBaseCandidate);
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "read");
          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });
          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);
          return toApiUpdate(update);
        }),
      ),
    )
    .handle("getGroup", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "read");
          const updateRepo = yield* UpdateRepo;
          const updates = yield* updateRepo.findByGroupId({ groupId: path.groupId });
          if (updates.length === 0) {
            return yield* Effect.fail(new NotFound({ message: "Update group not found" }));
          }
          const branchRepo = yield* BranchRepo;
          const [firstUpdate] = updates;
          if (!firstUpdate) {
            return yield* Effect.fail(new NotFound({ message: "Update group not found" }));
          }
          const branch = yield* branchRepo.findById({ id: firstUpdate.branchId });
          yield* assertProjectOwnership(branch.projectId);
          return { items: updates.map(toApiUpdate) };
        }),
      ),
    )
    .handle("listAssets", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("update", "read");
          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });
          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);
          const assets = yield* updateRepo.findAssetsByUpdateId({ updateId: path.id });
          return assets.map((asset) => ({
            hash: asset.hash,
            key: asset.key,
            isLaunch: asset.isLaunch,
            contentChecksum: toDbNull(asset.contentChecksum),
          }));
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

          // Route manual delete through the same orphan-aware asset cleanup the
          // OTA reaper uses, so the two paths never diverge (the plain deleteGroup
          // left assets/{hash} on R2). Only assets with zero surviving referrers
          // are removed; shared assets are kept. Record referenced hashes BEFORE
          // deleting update_assets, then test for orphans AFTER (a remaining
          // referrer is then a genuine survivor).
          const updateIds = updates.map((update) => update.id);
          const referencedHashes = yield* updateRepo.findAssetHashesForUpdates({ updateIds });
          const { updatesDeleted } = yield* updateRepo.deleteUpdateRows({ updateIds });

          const orphanHashes = yield* updateRepo.findUnreferencedAssetHashes({
            hashes: referencedHashes,
          });
          const orphanKeys = yield* updateRepo.findAssetR2KeysByHashes({ hashes: orphanHashes });

          const bundleRepo = yield* BundleRepo;
          yield* bundleRepo.deleteObjects({ keys: orphanKeys });
          yield* updateRepo.deleteAssetRows({ hashes: orphanHashes });
          const result = { deleted: updatesDeleted };

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
          const source = yield* resolveRepublishSource({ payload });
          const destination = yield* resolveRepublishDestination({
            payload,
            projectId: source.projectId,
          });

          // Per-channel publish gate on the destination channel (allow/deny grants
          // apply); a branch-only destination has no channel scope so the org-wide
          // baseline applies. Runs before the republish write.
          const { channelId } = destination;
          yield* channelId === null
            ? assertPermission("update", "create")
            : assertPermissionOn("update", "create", { scopeKind: "channel", scopeId: channelId });

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
