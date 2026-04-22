import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { runEffect } from "../../lib/citty-effect";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List channels for the linked project" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const [{ items }, { items: branches }] = yield* Effect.all([
          api.channels.list({ urlParams: { projectId, page: 1, limit: 1000 } }),
          api.branches.list({ urlParams: { projectId, page: 1, limit: 1000 } }),
        ]);

        if (items.length === 0) {
          yield* Console.log("No channels found.");
          return;
        }

        const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));

        yield* printTable(
          ["ID", "Name", "Branch", "Paused", "Rollout", "Created"],
          items.map((channel) => [
            channel.id,
            channel.name,
            branchNames.get(channel.branchId) ?? channel.branchId,
            channel.isPaused ? "yes" : "no",
            channel.branchMappingJson === null ? "-" : "active",
            channel.createdAt,
          ]),
        );
      }),
      channelErrorExtras,
    ),
});
