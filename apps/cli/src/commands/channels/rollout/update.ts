import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { parseRolloutPercentage } from "../../../lib/cli-schemas";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { apiClient } from "../../../services/api-client";

export const updateCommand = Command.make(
  "update",
  {
    channelId: Argument.String("channelId").pipe(Argument.withDescription("Channel ID")),
    percentage: Flag.String("percentage").pipe(
      Flag.withDescription("New rollout percentage (1-100)"),
    ),
  },
  Effect.fn(
    function* (args) {
      const percentage = yield* parseRolloutPercentage(args.percentage, "percentage");
      const api = yield* apiClient;
      const channel = yield* api.channels.updateBranchRollout({
        params: { id: args.channelId },
        payload: { percentage },
      });

      yield* printHuman(`Updated rollout on channel "${channel.name}" to ${String(percentage)}%.`);
      return channel;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Update the rollout percentage on a channel"));
