import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printJson, printTable } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";

export const republishCommand = defineCommand({
  meta: {
    name: "republish",
    description:
      "Copy an existing update (group or single platform) to a different branch, preserving the runtime version",
  },
  args: {
    group: { type: "string", description: "Source group ID (republish both platforms together)" },
    "to-branch": {
      type: "string",
      required: true,
      description: "Destination branch name or ID",
    },
    message: { type: "string", description: "Override the update message" },
    "project-id": {
      type: "string",
      description: "Project ID (required when --to-branch is a name, optional when ID)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.group === undefined) {
          return yield* new InvalidArgumentError({
            message: "Pass --group <groupId> to republish (other source modes coming soon).",
          });
        }
        const api = yield* apiClient;
        const result = yield* api.updates.republish({
          payload: {
            sourceGroupId: args.group,
            destinationBranchId: args["to-branch"],
            ...(args["project-id"] === undefined ? {} : { projectId: args["project-id"] }),
            ...(args.message === undefined ? {} : { message: args.message }),
          },
        });
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson(result);
          return undefined;
        }
        yield* printHuman(`Republished ${result.updates.length} update(s).`);
        yield* printTable(
          ["ID", "Platform", "Runtime version", "Group ID"],
          result.updates.map((update) => [
            update.id,
            update.platform,
            update.runtimeVersion,
            update.groupId,
          ]),
        );
        return undefined;
      }),
    ),
});
