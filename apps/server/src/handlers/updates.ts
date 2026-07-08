import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { CreateUpdateBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { UpdateCoordinator } from "../cloudflare/update-coordinator";
import { validateEmbeddedBaselineId } from "../domain/embedded-baseline-validation";
import { verifySignedUpdate } from "../domain/signed-update-verification";
import { validateUpdatePublishInput } from "../domain/update-publish-validation";
import { Conflict, NotFound } from "../errors";
import { toApiUpdate } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toApiPatchBaseCandidate } from "../http/to-api-patch";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { BranchRepo, BundleRepo, ChannelRepo, ProjectRepo, UpdateRepo } from "../repositories";
import {
  prepareRepublishUpdates,
  resolveRepublishDestination,
  resolveRepublishSource,
} from "./update-republish";
import { clampPatchBaseLimit, parseUpdateSort } from "./updates-helpers";
import { assertAssetsExist, resolvePatchBaseBranchId } from "./updates-read-scope";

const handleCreateUpdate = ({ payload }: { readonly payload: typeof CreateUpdateBody.Type }) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      // NOTE: the publish gate is per-channel (assertAccess on a {kind:"update"}
      // target) and runs AFTER `ensureBranchChannel` resolves the destination
      // channel scope below — not here. Everything before that gate is read-only
      // validation plus the channel-ensure itself, so no update write happens
      // before it. Read/delete of stored updates gate at the update's BRANCH
      // environment (the branch name), so environment-scoped grants apply; a
      // project-wide grant still covers them by prefix.

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

      // Publish gate BEFORE ensureBranchChannel — otherwise an actor with project
      // ownership but no `update:create` on this environment would create branch +
      // channel rows (and bypass the archived guard) before being rejected. The
      // channel NAME is the environment segment, so gating at the environment
      // applies per-environment grants + the protected-env guard; the channel is
      // 1:1 with the branch here, so environment scope is the right granularity.
      yield* assertAccess("update", "create", {
        kind: "environment",
        projectId: project.id,
        environment: payload.branch,
      });

      const coordinator = yield* UpdateCoordinator;
      const branchResult = yield* coordinator.ensureBranchChannel({
        projectId: project.id,
        branchName: payload.branch,
      });
      if (!branchResult.ok) {
        return yield* new Conflict({ message: branchResult.message });
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
        return yield* new Conflict({ message: publishResult.message });
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
    // if several map the branch); a channel-less branch gates on the branch name
    // as its environment (per-env grants + protected-env guard still apply).
    const channelRepoForGate = yield* ChannelRepo;
    const owningChannel = yield* channelRepoForGate.findByBranchId({ branchId: update.branchId });
    yield* owningChannel
      ? assertAccess("rollout", "update", {
          kind: "rollout",
          projectId: branch.projectId,
          environment: owningChannel.name,
          channelId: owningChannel.id,
        })
      : assertAccess("rollout", "update", {
          kind: "environment",
          projectId: branch.projectId,
          environment: branch.name,
        });

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
          yield* assertProjectOwnership(urlParams.projectId);

          const repo = yield* UpdateRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseUpdateSort(urlParams.sort);

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
            ...(urlParams.branchId?.length ? { branchId: urlParams.branchId } : {}),
            ...(urlParams.platform ? { platform: urlParams.platform } : {}),
            ...(urlParams.runtimeVersion ? { runtimeVersion: urlParams.runtimeVersion } : {}),
            ...(urlParams.query ? { query: urlParams.query } : {}),
            sort,
            order,
            limit,
            offset,
          });

          // Roles are project-wide (GITLAB-RBAC-SPEC §1): the update:read gate
          // above already admitted the caller to the whole project — no
          // per-branch filtering.
          return { items: items.map(toApiUpdate), total, page, limit };
        }),
      ),
    )
    .handle("listPatchBases", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(urlParams.projectId);

          const branchId = yield* resolvePatchBaseBranchId({
            projectId: urlParams.projectId,
            branchId: urlParams.branchId,
            channel: urlParams.channel,
          });

          // Read gate at the patch-base branch's environment (its NAME), so an
          // environment-scoped grant works; project-wide `update:read` still
          // covers it by prefix.
          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: branchId });
          yield* assertAccess("update", "read", {
            kind: "environment",
            projectId: urlParams.projectId,
            environment: branch.name,
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
          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });
          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);
          yield* assertAccess("update", "read", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });
          return toApiUpdate(update);
        }),
      ),
    )
    .handle("getGroup", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const updateRepo = yield* UpdateRepo;
          const updates = yield* updateRepo.findByGroupId({ groupId: path.groupId });
          if (updates.length === 0) {
            return yield* new NotFound({ message: "Update group not found" });
          }
          const branchRepo = yield* BranchRepo;
          const [firstUpdate] = updates;
          if (!firstUpdate) {
            return yield* new NotFound({ message: "Update group not found" });
          }
          const branch = yield* branchRepo.findById({ id: firstUpdate.branchId });
          yield* assertProjectOwnership(branch.projectId);
          yield* assertAccess("update", "read", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });
          return { items: updates.map(toApiUpdate) };
        }),
      ),
    )
    .handle("listAssets", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const updateRepo = yield* UpdateRepo;
          const update = yield* updateRepo.findById({ id: path.id });
          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: update.branchId });
          yield* assertProjectOwnership(branch.projectId);
          yield* assertAccess("update", "read", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });
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
          const updateRepo = yield* UpdateRepo;
          const updates = yield* updateRepo.findByGroupId({ groupId: path.groupId });
          if (updates.length === 0) {
            return yield* new NotFound({ message: "Update group not found" });
          }

          // Verify ownership via branch -> project
          const branchRepo = yield* BranchRepo;
          const [firstUpdate] = updates;
          if (!firstUpdate) {
            return yield* new NotFound({ message: "Update group not found" });
          }
          const branch = yield* branchRepo.findById({ id: firstUpdate.branchId });
          yield* assertProjectOwnership(branch.projectId);
          // The branch name is the environment segment (per-env grants + the
          // protected-env guard apply to destructive update removal).
          yield* assertAccess("update", "delete", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });

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
          // apply); a branch-only destination gates on the branch name as its
          // environment. Runs before the republish write.
          const { channelId } = destination;
          yield* channelId === null
            ? assertAccess("update", "create", {
                kind: "environment",
                projectId: source.projectId,
                environment: destination.environmentName,
              })
            : assertAccess("update", "create", {
                kind: "update",
                projectId: source.projectId,
                environment: destination.environmentName,
                channelId,
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
            return yield* new Conflict({ message: publishResult.message });
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
