import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const resumeCommand = Command.make(
  "resume",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Channel ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const channel = yield* api.channels.resume({ params: { id: args.id } });
      yield* printHuman(`Channel "${channel.name}" resumed.`);
      return channel;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Resume a paused channel"));
