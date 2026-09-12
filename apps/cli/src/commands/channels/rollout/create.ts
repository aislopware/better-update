import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { parseRolloutPercentage } from "../../../lib/cli-schemas";
import { drainPages } from "../../../lib/drain-cursor";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { readProjectId } from "../../../lib/project-link";
import { runCommand } from "../../../lib/run-command";
import { apiClient } from "../../../services/api-client";
import { resolveNamedResourceId } from "../helpers";

export const createCommand = Command.make(
  "create",
  {
    channelId: Argument.String("channelId").pipe(Argument.withDescription("Channel ID")),
    branch: Flag.String("branch").pipe(Flag.withDescription("Target branch name")),
    percentage: Flag.String("percentage").pipe(
      Flag.withDescription("Initial rollout percentage (1-100)"),
    ),
    "runtime-version": Flag.String("runtime-version").pipe(
      Flag.withDescription("Constrain the rollout to a single runtime version"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const percentage = yield* parseRolloutPercentage(args.percentage, "percentage");
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const branches = yield* drainPages((page) =>
        api.branches.list({
          query: { projectId, limit: 100, page },
        }),
      );
      const newBranchId = yield* resolveNamedResourceId({
        items: branches,
        kind: "Branch",
        name: args.branch,
      });

      const runtimeVersion = args["runtime-version"];

      const channel = yield* api.channels.createBranchRollout({
        params: { id: args.channelId },
        payload: compact({ newBranchId, percentage, runtimeVersion }),
      });

      const rtvSuffix =
        runtimeVersion === undefined ? "" : ` (runtime version "${runtimeVersion}" only)`;
      yield* printHuman(
        `Started rollout on channel "${channel.name}" to branch "${args.branch}" at ${String(percentage)}%${rtvSuffix}.`,
      );
      return channel;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Start a branch rollout on a channel"));
