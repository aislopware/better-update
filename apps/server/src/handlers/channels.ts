import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import {
  buildBranchMapping,
  extractNewBranchId,
  extractReachableBranchIds,
  updateBranchMappingPercentage,
} from "../domain/branch-mapping";
import { Conflict, NotFound } from "../errors";
import { toApiBuild, toApiChannel } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { BranchRepo } from "../repositories/branches";
import { BuildRepo } from "../repositories/builds";
import { ChannelRepo } from "../repositories/channels";
import { ProjectRepo } from "../repositories/projects";

import type { Action } from "../models";
import type { ChannelSortKey, ChannelSortOrder } from "../repositories/channels";

const parseChannelSort = (
  value: string | undefined = "-createdAt",
): { readonly sort: ChannelSortKey; readonly order: ChannelSortOrder } => {
  const order: ChannelSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "name":
    case "createdAt": {
      return { sort: column, order };
    }
    default: {
      return { sort: "createdAt", order: "desc" };
    }
  }
};

// Builds compatible with the channel, server-filtered with an exact total.
// Top-level (not inline in the group closure) to keep the group function under
// the line budget.
const listCompatibleBuildsForChannel = (
  id: string,
  urlParams: { readonly page?: number | undefined; readonly limit?: number | undefined },
) =>
  Effect.gen(function* () {
    const repo = yield* ChannelRepo;
    const channel = yield* repo.findById({ id });
    // Read gate, same as get: project ownership admits the caller.
    yield* assertProjectOwnership(channel.projectId);

    const { page, limit, offset } = parsePagination(urlParams);
    // During a rollout both mapped branches serve updates, so builds matching
    // either count as compatible — mirrors the matrix's reachable-branch union
    // (default branch_id always included).
    const branchIds =
      channel.branchMappingJson === null
        ? [channel.branchId]
        : [...new Set([channel.branchId, ...extractReachableBranchIds(channel.branchMappingJson)])];

    const buildRepo = yield* BuildRepo;
    const { items, total } = yield* buildRepo.listCompatibleWithBranches({
      projectId: channel.projectId,
      branchIds,
      limit,
      offset,
    });

    return { items: items.map(toApiBuild), total, page, limit };
  });

// Load a channel and run the ownership + access gates for a write on it. The
// channel NAME is its environment segment, so per-environment grants + the
// protected-env guard apply.
const gateChannelWrite = (id: string, resource: "channel" | "rollout", action: Action) =>
  Effect.gen(function* () {
    const repo = yield* ChannelRepo;
    const channel = yield* repo.findById({ id });
    yield* assertProjectOwnership(channel.projectId);
    yield* assertAccess(resource, action, {
      kind: resource,
      projectId: channel.projectId,
      environment: channel.name,
      channelId: id,
    });
    return channel;
  });

export const ChannelsGroupLive = HttpApiBuilder.group(ManagementApi, "channels", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(payload.projectId);
          // Env-scoped create gate: the channel's NAME is its environment
          // segment, so per-environment grants + the protected-env guard apply.
          yield* assertAccess("channel", "create", {
            kind: "environment",
            projectId: payload.projectId,
            environment: payload.name,
          });

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.branchId });
          if (branch.projectId !== payload.projectId) {
            return yield* new NotFound({ message: "Branch not found" });
          }

          const repo = yield* ChannelRepo;
          const projectRepo = yield* ProjectRepo;
          const inserted = yield* repo.insert({
            projectId: payload.projectId,
            name: payload.name,
            branchId: payload.branchId,
          });
          // insert() returns the raw row shape; the branch was just loaded for
          // validation, so attach its name instead of re-reading.
          const channel = { ...inserted, branchName: branch.name };
          yield* projectRepo.bumpLastActivity({
            projectId: payload.projectId,
            at: new Date().toISOString(),
          });

          yield* logAudit({
            action: "channel.create",
            resourceType: "channel",
            resourceId: channel.id,
            projectId: payload.projectId,
            metadata: { name: payload.name, projectId: payload.projectId },
          });

          return toApiChannel(channel);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(urlParams.projectId);
          const repo = yield* ChannelRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseChannelSort(urlParams.sort);

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
            ...(urlParams.query ? { query: urlParams.query } : {}),
            ...(urlParams.branchId ? { branchId: urlParams.branchId } : {}),
            sort,
            order,
            limit,
            offset,
          });

          // Roles are project-wide (GITLAB-RBAC-SPEC §1): the channel:read gate
          // above already admitted the caller to the whole project, so every
          // channel is visible — no per-environment filtering.
          const visible = items;

          return {
            items: visible.map(toApiChannel),
            total,
            page,
            limit,
          };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          // Same gate as list: project ownership admits the caller to every
          // channel in the project (roles are project-wide).
          yield* assertProjectOwnership(channel.projectId);
          return toApiChannel(channel);
        }),
      ),
    )
    .handle("listCompatibleBuilds", ({ path, urlParams }) =>
      toApiCrudEffect(listCompatibleBuildsForChannel(path.id, urlParams)),
    )
    .handle("update", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "channel", "update");

          if (channel.branchMappingJson !== null) {
            return yield* new Conflict({ message: "Cannot relink while a rollout is active" });
          }

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.branchId });
          if (branch.projectId !== channel.projectId) {
            return yield* new NotFound({ message: "Branch not found" });
          }

          yield* repo.updateBranchId({ id: path.id, branchId: payload.branchId });

          yield* logAudit({
            action: "channel.update",
            resourceType: "channel",
            resourceId: path.id,
            projectId: channel.projectId,
            metadata: { branchId: payload.branchId },
          });

          return toApiChannel({ ...channel, branchId: payload.branchId, branchName: branch.name });
        }),
      ),
    )
    .handle("pause", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "channel", "update");
          yield* repo.setPaused({ id: path.id, isPaused: true });
          return toApiChannel({ ...channel, isPaused: true });
        }),
      ),
    )
    .handle("resume", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "channel", "update");
          yield* repo.setPaused({ id: path.id, isPaused: false });
          return toApiChannel({ ...channel, isPaused: false });
        }),
      ),
    )
    .handle("createBranchRollout", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "rollout", "create");

          if (channel.branchMappingJson !== null) {
            return yield* new Conflict({ message: "Rollout already active" });
          }
          if (payload.newBranchId === channel.branchId) {
            return yield* new Conflict({ message: "Cannot rollout to the current branch" });
          }

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.newBranchId });
          if (branch.projectId !== channel.projectId) {
            return yield* new NotFound({ message: "Branch not found" });
          }

          const branchMappingJson = buildBranchMapping({
            newBranchId: payload.newBranchId,
            oldBranchId: channel.branchId,
            percentage: payload.percentage,
            salt: crypto.randomUUID(),
            runtimeVersion: payload.runtimeVersion,
          });
          yield* repo.setBranchMapping({ id: path.id, branchMappingJson });
          return toApiChannel({
            ...channel,
            branchMappingJson,
            rolloutTargetBranchName: branch.name,
          });
        }),
      ),
    )
    .handle("updateBranchRollout", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "rollout", "update");

          if (channel.branchMappingJson === null) {
            return yield* new NotFound({ message: "No active rollout" });
          }

          const branchMappingJson = updateBranchMappingPercentage(
            channel.branchMappingJson,
            payload.percentage,
          );
          yield* repo.setBranchMapping({ id: path.id, branchMappingJson });
          return toApiChannel({ ...channel, branchMappingJson });
        }),
      ),
    )
    .handle("completeBranchRollout", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "rollout", "update");

          if (channel.branchMappingJson === null) {
            return yield* new NotFound({ message: "No active rollout" });
          }

          const newBranchId = extractNewBranchId(channel.branchMappingJson);
          if (newBranchId === null) {
            return yield* new NotFound({ message: "Branch mapping is empty" });
          }
          yield* repo.completeBranchRollout({ id: path.id, branchId: newBranchId });
          // The rollout target becomes the linked branch, so its name moves too.
          return toApiChannel({
            ...channel,
            branchId: newBranchId,
            branchName: channel.rolloutTargetBranchName,
            branchMappingJson: null,
            rolloutTargetBranchName: undefined,
          });
        }),
      ),
    )
    .handle("revertBranchRollout", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "rollout", "update");

          if (channel.branchMappingJson === null) {
            return yield* new NotFound({ message: "No active rollout" });
          }

          yield* repo.revertBranchRollout({ id: path.id });
          return toApiChannel({
            ...channel,
            branchMappingJson: null,
            rolloutTargetBranchName: undefined,
          });
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const channelRepo = yield* ChannelRepo;
          const channel = yield* gateChannelWrite(path.id, "channel", "delete");
          if (channel.isBuiltin) {
            return yield* new Conflict({
              message: `Built-in channel "${channel.name}" cannot be deleted`,
            });
          }
          yield* channelRepo.delete({ id: path.id });

          yield* logAudit({
            action: "channel.delete",
            resourceType: "channel",
            resourceId: path.id,
            projectId: channel.projectId,
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
