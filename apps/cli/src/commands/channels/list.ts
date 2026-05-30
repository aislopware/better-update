import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { printList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List channels for the linked project" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const [items, branches] = yield* Effect.all([
          drainPages((page) =>
            api.channels.list({
              urlParams: { projectId, limit: 100, page },
            }),
          ),
          drainPages((page) =>
            api.branches.list({
              urlParams: { projectId, limit: 100, page },
            }),
          ),
        ]);

        const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

        yield* printList(
          ["ID", "Name", "Branch", "Paused", "Rollout", "Created"],
          items.map((channel) => [
            channel.id,
            channel.name,
            branchNames.get(channel.branchId) ?? channel.branchId,
            channel.isPaused ? "yes" : "no",
            channel.branchMappingJson === null ? "-" : "active",
            channel.createdAt,
          ]),
          "No channels found.",
        );
      }),
      channelErrorExtras,
    ),
});
