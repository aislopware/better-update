import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { runEffect } from "../../lib/citty-effect";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras, resolveNamedResourceId } from "./helpers";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Relink a channel to a different branch" },
  args: {
    id: { type: "positional", required: true, description: "Channel ID" },
    branch: { type: "string", required: true, description: "Target branch name" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const { items: branches } = yield* api.branches.list({
          urlParams: { projectId, page: 1, limit: 1000 },
        });
        const branchId = yield* resolveNamedResourceId({
          items: branches,
          kind: "Branch",
          name: args.branch,
        });

        const channel = yield* api.channels.update({
          path: { id: args.id },
          payload: { branchId },
        });

        yield* Console.log(`Channel "${channel.name}" relinked to branch "${args.branch}".`);
      }),
      channelErrorExtras,
    ),
});
