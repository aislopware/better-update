import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { Update } from "../domain/update";

const stubUpdate = new Update({
  id: "00000000-0000-0000-0000-000000000000",
  branchId: "00000000-0000-0000-0000-000000000000",
  runtimeVersion: "1.0.0",
  platform: "ios",
  message: "stub update",
  metadataJson: "{}",
  extraJson: null,
  groupId: "00000000-0000-0000-0000-000000000000",
  rolloutPercentage: 100,
  isRollback: false,
  signature: null,
  certificateChain: null,
  manifestBody: null,
  directiveBody: null,
  createdAt: "2026-01-01T00:00:00Z",
});

export const UpdatesGroupLive = HttpApiBuilder.group(ManagementApi, "updates", (handlers) =>
  handlers
    .handle("create", () => Effect.succeed(stubUpdate))
    .handle("list", () => Effect.succeed({ items: [], total: 0, page: 1, limit: 20 }))
    .handle("deleteGroup", () => Effect.succeed({ deleted: 0 }))
    .handle("republish", () => Effect.succeed(stubUpdate))
    .handle("editRollout", () => Effect.succeed(stubUpdate))
    .handle("completeRollout", () => Effect.succeed(stubUpdate))
    .handle("revertRollout", () => Effect.succeed(stubUpdate)),
);
