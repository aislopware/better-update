import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { readProjectId } from "../../lib/expo-config";
import { printJson, printKeyValue } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";
import { ChannelCommandError, channelErrorExtras } from "./helpers";

export const viewCommand = defineCommand({
  meta: { name: "view", description: "Show a channel by ID or name" },
  args: {
    target: {
      type: "positional",
      required: true,
      description: "Channel ID or channel name",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const [channels, branches] = yield* Effect.all([
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

        const channel =
          channels.find((entry) => entry.id === args.target) ??
          channels.find((entry) => entry.name === args.target);

        if (!channel) {
          return yield* Effect.fail(
            new ChannelCommandError({
              message: `Channel "${args.target}" not found by ID or name.`,
            }),
          );
        }

        const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
        const branchName = branchNames.get(channel.branchId) ?? channel.branchId;

        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson({
            id: channel.id,
            projectId: channel.projectId,
            name: channel.name,
            branchId: channel.branchId,
            branchName,
            branchMappingJson: channel.branchMappingJson,
            cacheVersion: channel.cacheVersion,
            isPaused: channel.isPaused,
            createdAt: channel.createdAt,
          });
          return undefined;
        }

        yield* printKeyValue([
          ["ID", channel.id],
          ["Name", channel.name],
          ["Project ID", channel.projectId],
          ["Branch", `${branchName} (${channel.branchId})`],
          ["Paused", channel.isPaused ? "yes" : "no"],
          ["Rollout", channel.branchMappingJson ?? "-"],
          ["Cache version", String(channel.cacheVersion)],
          ["Created", channel.createdAt],
        ]);
        return undefined;
      }),
      channelErrorExtras,
    ),
});
