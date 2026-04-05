import { Channel } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";

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
    .handle("create", () => Effect.succeed(stubChannel))
    .handle("update", () => Effect.succeed(stubChannel))
    .handle("list", () => Effect.succeed({ items: [], total: 0, page: 1, limit: 20 }))
    .handle("pause", () => Effect.succeed(stubChannel))
    .handle("resume", () => Effect.succeed(stubChannel))
    .handle("createBranchRollout", () => Effect.succeed(stubChannel))
    .handle("updateBranchRollout", () => Effect.succeed(stubChannel))
    .handle("completeBranchRollout", () => Effect.succeed(stubChannel))
    .handle("revertBranchRollout", () => Effect.succeed(stubChannel)),
);
