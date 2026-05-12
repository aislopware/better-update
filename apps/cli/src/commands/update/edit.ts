import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseRolloutPercentage } from "../../lib/cli-schemas";
import { drainPages } from "../../lib/drain-cursor";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { UpdateCommandError, updateErrorExtras } from "./helpers";

export const editCommand = defineCommand({
  meta: {
    name: "edit",
    description: "Edit rollout percentage for every update in a group",
  },
  args: {
    groupId: { type: "positional", required: true, description: "Update group ID" },
    "rollout-percentage": {
      type: "string",
      description: "New rollout percentage (1-100)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const rolloutRaw = args["rollout-percentage"];
        if (rolloutRaw === undefined) {
          return yield* new InvalidArgumentError({
            message: "Nothing to edit. Pass --rollout-percentage <n> (1-100).",
          });
        }
        const percentage = yield* parseRolloutPercentage(rolloutRaw, "rollout-percentage");

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
          (update) =>
            api.updates.editRollout({
              path: { id: update.id },
              payload: { percentage },
            }),
          { concurrency: 2 },
        );

        yield* printHuman(
          `Set rollout to ${String(percentage)}% for ${String(inGroup.length)} update(s) in group ${args.groupId}.`,
        );
        return undefined;
      }),
      updateErrorExtras,
    ),
});
