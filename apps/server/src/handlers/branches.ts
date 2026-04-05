import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { Branch } from "../domain/branch";

const stubBranch = new Branch({
  id: "00000000-0000-0000-0000-000000000000",
  projectId: "00000000-0000-0000-0000-000000000000",
  name: "stub-branch",
  createdAt: "2026-01-01T00:00:00Z",
});

export const BranchesGroupLive = HttpApiBuilder.group(ManagementApi, "branches", (handlers) =>
  handlers
    .handle("create", () => Effect.succeed(stubBranch))
    .handle("list", () => Effect.succeed({ items: [], total: 0, page: 1, limit: 20 }))
    .handle("rename", () => Effect.succeed(stubBranch)),
);
