import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import {
  buildBranchMapping,
  extractNewBranchId,
  updateBranchMappingPercentage,
} from "../domain/branch-mapping";
import { Conflict, NotFound } from "../errors";
import { toApiChannel } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";

export const ChannelsGroupLive = HttpApiBuilder.group(ManagementApi, "channels", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("channel", "create");
          yield* assertProjectOwnership(payload.projectId);

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.branchId });
          if (branch.projectId !== payload.projectId) {
            return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
          }

          const repo = yield* ChannelRepo;
          const channel = yield* repo.insert({
            projectId: payload.projectId,
            name: payload.name,
            branchId: payload.branchId,
          });

          yield* logAudit({
            action: "channel.create",
            resourceType: "channel",
            resourceId: channel.id,
            metadata: { name: payload.name, projectId: payload.projectId },
          });

          return toApiChannel(channel);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("channel", "read");
          yield* assertProjectOwnership(urlParams.projectId);
          const repo = yield* ChannelRepo;
          const page = urlParams.page ?? 1;
          const limit = urlParams.limit ?? 20;
          const offset = (page - 1) * limit;

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
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
          yield* assertPermission("channel", "update");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);

          if (channel.branchMappingJson !== null) {
            return yield* Effect.fail(
              new Conflict({ message: "Cannot relink while a rollout is active" }),
            );
          }

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.branchId });
          if (branch.projectId !== channel.projectId) {
            return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
          }

          yield* repo.updateBranchId({ id: path.id, branchId: payload.branchId });

          yield* logAudit({
            action: "channel.update",
            resourceType: "channel",
            resourceId: path.id,
            metadata: { branchId: payload.branchId },
          });

          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("pause", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("channel", "update");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* repo.setPaused({ id: path.id, isPaused: true });
          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("resume", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("channel", "update");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* repo.setPaused({ id: path.id, isPaused: false });
          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("createBranchRollout", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "create");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);

          if (channel.branchMappingJson !== null) {
            return yield* Effect.fail(new Conflict({ message: "Rollout already active" }));
          }
          if (payload.newBranchId === channel.branchId) {
            return yield* Effect.fail(
              new Conflict({ message: "Cannot rollout to the current branch" }),
            );
          }

          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: payload.newBranchId });
          if (branch.projectId !== channel.projectId) {
            return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
          }

          const branchMappingJson = buildBranchMapping({
            newBranchId: payload.newBranchId,
            oldBranchId: channel.branchId,
            percentage: payload.percentage,
            salt: crypto.randomUUID(),
          });
          yield* repo.setBranchMapping({ id: path.id, branchMappingJson });
          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("updateBranchRollout", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "update");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);

          if (channel.branchMappingJson === null) {
            return yield* Effect.fail(new NotFound({ message: "No active rollout" }));
          }

          const branchMappingJson = updateBranchMappingPercentage(
            channel.branchMappingJson,
            payload.percentage,
          );
          yield* repo.setBranchMapping({ id: path.id, branchMappingJson });
          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("completeBranchRollout", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "update");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);

          if (channel.branchMappingJson === null) {
            return yield* Effect.fail(new NotFound({ message: "No active rollout" }));
          }

          const newBranchId = extractNewBranchId(channel.branchMappingJson);
          yield* repo.completeBranchRollout({ id: path.id, branchId: newBranchId });
          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("revertBranchRollout", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("rollout", "update");
          const repo = yield* ChannelRepo;
          const channel = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);

          if (channel.branchMappingJson === null) {
            return yield* Effect.fail(new NotFound({ message: "No active rollout" }));
          }

          yield* repo.revertBranchRollout({ id: path.id });
          return toApiChannel(yield* repo.findById({ id: path.id }));
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("channel", "delete");
          const channelRepo = yield* ChannelRepo;
          const channel = yield* channelRepo.findById({ id: path.id });
          yield* assertProjectOwnership(channel.projectId);
          yield* channelRepo.delete({ id: path.id });

          yield* logAudit({
            action: "channel.delete",
            resourceType: "channel",
            resourceId: path.id,
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
