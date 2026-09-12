import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { apiClient } from "../../../services/api-client";

export const revertCommand = Command.make(
  "revert",
  {
    channelId: Argument.String("channelId").pipe(Argument.withDescription("Channel ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const channel = yield* api.channels.revertBranchRollout({
        params: { id: args.channelId },
      });
      yield* printHuman(`Reverted rollout on channel "${channel.name}".`);
      return channel;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Revert the active branch rollout"));
