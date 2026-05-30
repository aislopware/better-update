import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { UpdateCommandError, updateErrorExtras } from "./helpers";

export const revertRolloutCommand = defineCommand({
  meta: {
    name: "revert-rollout",
    description: "Revert in-progress rollout for every update in a group",
  },
  args: {
    groupId: { type: "positional", required: true, description: "Update group ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const allUpdates = yield* drainPages((page) =>
          api.updates.list({ urlParams: { projectId, limit: 100, page } }),
        );
        const inGroup = allUpdates.filter((update) => update.groupId === args.groupId);
        if (inGroup.length === 0) {
          return yield* new UpdateCommandError({
            message: `No updates found for group ${args.groupId}.`,
          });
        }

        yield* Effect.forEach(
          inGroup,
          (update) => api.updates.revertRollout({ path: { id: update.id } }),
          { concurrency: 2 },
        );

        yield* printHuman(
          `Reverted rollout for ${String(inGroup.length)} update(s) in group ${args.groupId}.`,
        );
        return undefined;
      }),
      updateErrorExtras,
    ),
});
