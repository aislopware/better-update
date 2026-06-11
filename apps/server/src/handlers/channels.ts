import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import {
  buildBranchMapping,
  extractNewBranchId,
  updateBranchMappingPercentage,
} from "../domain/branch-mapping";
import { Conflict, NotFound } from "../errors";
import { toApiChannel } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";
import { ProjectRepo } from "../repositories/projects";

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

export const ChannelsGroupLive = HttpApiBuilder.group(ManagementApi, "channels", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(payload.projectId);
          yield* assertAccess("channel", "create", {
            kind: "project",
            projectId: payload.projectId,
          });

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.branchId });
          if (branch.projectId !== payload.projectId) {
            return yield* new NotFound({ message: "Branch not found" });
          }

          const repo = yield* ChannelRepo;
          const projectRepo = yield* ProjectRepo;
          const channel = yield* repo.insert({
            projectId: payload.projectId,
            name: payload.name,
            branchId: payload.branchId,
          });
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
          yield* assertAccess("channel", "read", {
            kind: "project",
            projectId: urlParams.projectId,
          });
          const repo = yield* ChannelRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseChannelSort(urlParams.sort);

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
            ...(urlParams.query ? { query: urlParams.query } : {}),
            sort,
            order,
            limit,
            offset,
          });

          return { items: items.map(toApiChannel), total, page, limit };
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("channel", "update", {
            kind: "channel",
            projectId: channel.projectId,
            channelId: path.id,
          });

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

          return toApiChannel({ ...channel, branchId: payload.branchId });
        }),
      ),
    )
    .handle("pause", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("channel", "update", {
            kind: "channel",
            projectId: channel.projectId,
            channelId: path.id,
          });
          yield* repo.setPaused({ id: path.id, isPaused: true });
          return toApiChannel({ ...channel, isPaused: true });
        }),
      ),
    )
    .handle("resume", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("channel", "update", {
            kind: "channel",
            projectId: channel.projectId,
            channelId: path.id,
          });
          yield* repo.setPaused({ id: path.id, isPaused: false });
          return toApiChannel({ ...channel, isPaused: false });
        }),
      ),
    )
    .handle("createBranchRollout", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("rollout", "create", {
            kind: "rollout",
            projectId: channel.projectId,
            channelId: path.id,
          });

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
          return toApiChannel({ ...channel, branchMappingJson });
        }),
      ),
    )
    .handle("updateBranchRollout", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("rollout", "update", {
            kind: "rollout",
            projectId: channel.projectId,
            channelId: path.id,
          });

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
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("rollout", "update", {
            kind: "rollout",
            projectId: channel.projectId,
            channelId: path.id,
          });

          if (channel.branchMappingJson === null) {
            return yield* new NotFound({ message: "No active rollout" });
          }

          const newBranchId = extractNewBranchId(channel.branchMappingJson);
          if (newBranchId === null) {
            return yield* new NotFound({ message: "Branch mapping is empty" });
          }
          yield* repo.completeBranchRollout({ id: path.id, branchId: newBranchId });
          return toApiChannel({ ...channel, branchId: newBranchId, branchMappingJson: null });
        }),
      ),
    )
    .handle("revertBranchRollout", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("rollout", "update", {
            kind: "rollout",
            projectId: channel.projectId,
            channelId: path.id,
          });

          if (channel.branchMappingJson === null) {
            return yield* new NotFound({ message: "No active rollout" });
          }

          yield* repo.revertBranchRollout({ id: path.id });
          return toApiChannel({ ...channel, branchMappingJson: null });
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const channelRepo = yield* ChannelRepo;
          const channel = yield* channelRepo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* assertAccess("channel", "delete", {
            kind: "channel",
            projectId: channel.projectId,
            channelId: path.id,
          });
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
