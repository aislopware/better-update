import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { readProjectId } from "../../lib/expo-config";
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

        const branches = yield* drainPages((page) =>
          api.branches.list({
            urlParams: { projectId, limit: 100, page },
          }),
        );
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
