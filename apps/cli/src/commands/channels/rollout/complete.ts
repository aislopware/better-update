import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../../services/api-client";
import { handleChannelCommandErrors } from "../helpers";

const channelId = Args.text({ name: "channelId" });

export const completeCommand = Command.make("complete", { channelId }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const channel = yield* api.channels.completeBranchRollout({
      path: { id: opts.channelId },
    });
    yield* Console.log(`Completed rollout on channel "${channel.name}".`);
  }).pipe(handleChannelCommandErrors),
);
