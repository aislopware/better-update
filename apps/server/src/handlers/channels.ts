import { Channel, NotFound } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";

const stubChannel = new Channel({
  id: "00000000-0000-0000-0000-000000000000",
  projectId: "00000000-0000-0000-0000-000000000000",
  name: "stub-channel",
  branchId: "00000000-0000-0000-0000-000000000000",
  branchMappingJson: null,
  cacheVersion: 0,
  isPaused: false,
  createdAt: "2026-01-01T00:00:00Z",
});

export const ChannelsGroupLive = HttpApiBuilder.group(ManagementApi, "channels", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("channel", "create");
        yield* assertProjectOwnership(payload.projectId);

        const branchRepo = yield* BranchRepo;
        const branch = yield* branchRepo.findById({ id: payload.branchId });
        if (branch.projectId !== payload.projectId) {
          return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
        }

        const repo = yield* ChannelRepo;
        return yield* repo.insert({
          projectId: payload.projectId,
          name: payload.name,
          branchId: payload.branchId,
        });
      }),
    )
    .handle("list", ({ urlParams }) =>
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

        return { items, total, page, limit };
      }),
    )
    .handle("update", ({ path, payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("channel", "update");
        const repo = yield* ChannelRepo;
        const channel = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(channel.projectId);

        const branchRepo = yield* BranchRepo;
        const branch = yield* branchRepo.findById({ id: payload.branchId });
        if (branch.projectId !== channel.projectId) {
          return yield* Effect.fail(new NotFound({ message: "Branch not found" }));
        }

        yield* repo.updateBranchId({ id: path.id, branchId: payload.branchId });
        return yield* repo.findById({ id: path.id });
      }),
    )
    .handle("pause", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("channel", "update");
        const repo = yield* ChannelRepo;
        const channel = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(channel.projectId);
        yield* repo.setPaused({ id: path.id, isPaused: true });
        return yield* repo.findById({ id: path.id });
      }),
    )
    .handle("resume", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("channel", "update");
        const repo = yield* ChannelRepo;
        const channel = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(channel.projectId);
        yield* repo.setPaused({ id: path.id, isPaused: false });
        return yield* repo.findById({ id: path.id });
      }),
    )
    .handle("createBranchRollout", () => Effect.succeed(stubChannel))
    .handle("updateBranchRollout", () => Effect.succeed(stubChannel))
    .handle("completeBranchRollout", () => Effect.succeed(stubChannel))
    .handle("revertBranchRollout", () => Effect.succeed(stubChannel)),
);
