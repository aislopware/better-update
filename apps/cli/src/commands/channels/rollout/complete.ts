import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { apiClient } from "../../../services/api-client";

export const completeCommand = Command.make(
  "complete",
  {
    channelId: Argument.String("channelId").pipe(Argument.withDescription("Channel ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const channel = yield* api.channels.completeBranchRollout({
        params: { id: args.channelId },
      });
      yield* printHuman(`Completed rollout on channel "${channel.name}".`);
      return channel;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Complete the active branch rollout"));
