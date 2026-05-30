import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { parseRolloutPercentage } from "../../../lib/cli-schemas";
import { drainPages } from "../../../lib/drain-cursor";
import { printHuman } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import { channelErrorExtras, resolveNamedResourceId } from "../helpers";

export const createCommand = defineCommand({
  meta: { name: "create", description: "Start a branch rollout on a channel" },
  args: {
    channelId: { type: "positional", required: true, description: "Channel ID" },
    branch: { type: "string", required: true, description: "Target branch name" },
    percentage: {
      type: "string",
      required: true,
      description: "Initial rollout percentage (1-100)",
    },
    "runtime-version": {
      type: "string",
      description: "Constrain the rollout to a single runtime version",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const percentage = yield* parseRolloutPercentage(args.percentage, "percentage");
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const branches = yield* drainPages((page) =>
          api.branches.list({
            urlParams: { projectId, limit: 100, page },
          }),
        );
        const newBranchId = yield* resolveNamedResourceId({
          items: branches,
          kind: "Branch",
          name: args.branch,
        });

        const runtimeVersion = args["runtime-version"];

        const channel = yield* api.channels.createBranchRollout({
          path: { id: args.channelId },
          payload: compact({ newBranchId, percentage, runtimeVersion }),
        });

        const rtvSuffix =
          runtimeVersion === undefined ? "" : ` (runtime version "${runtimeVersion}" only)`;
        yield* printHuman(
          `Started rollout on channel "${channel.name}" to branch "${args.branch}" at ${String(percentage)}%${rtvSuffix}.`,
        );
        return channel;
      }),
      { exits: channelErrorExtras, json: "value" },
    ),
});
