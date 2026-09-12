import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { drainPages } from "../../lib/drain-cursor";
import { printHumanKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { ChannelCommandError } from "./helpers";

export const viewCommand = Command.make(
  "view",
  {
    target: Argument.String("target").pipe(Argument.withDescription("Channel ID or channel name")),
  },
  Effect.fn(
    function* (args) {
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const [channels, branches] = yield* Effect.all([
        drainPages((page) =>
          api.channels.list({
            query: { projectId, limit: 100, page },
          }),
        ),
        drainPages((page) =>
          api.branches.list({
            query: { projectId, limit: 100, page },
          }),
        ),
      ]);

      const channel =
        channels.find((entry) => entry.id === args.target) ??
        channels.find((entry) => entry.name === args.target);

      if (!channel) {
        return yield* new ChannelCommandError({
          message: `Channel "${args.target}" not found by ID or name.`,
        });
      }

      const branchNames = new Map(branches.map((branch) => [branch.id, branch.name]));
      const branchName = branchNames.get(channel.branchId) ?? channel.branchId;

      yield* printHumanKeyValue([
        ["ID", channel.id],
        ["Name", channel.name],
        ["Project ID", channel.projectId],
        ["Branch", `${branchName} (${channel.branchId})`],
        ["Paused", channel.isPaused ? "yes" : "no"],
        ["Rollout", channel.branchMappingJson ?? "-"],
        ["Cache version", String(channel.cacheVersion)],
        ["Created", channel.createdAt],
      ]);
      return {
        id: channel.id,
        projectId: channel.projectId,
        name: channel.name,
        branchId: channel.branchId,
        branchName,
        branchMappingJson: channel.branchMappingJson,
        cacheVersion: channel.cacheVersion,
        isPaused: channel.isPaused,
        createdAt: channel.createdAt,
      };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show a channel by ID or name"));
