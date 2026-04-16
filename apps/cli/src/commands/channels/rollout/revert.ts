import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../../services/api-client";
import { handleChannelCommandErrors } from "../helpers";

const channelId = Args.text({ name: "channelId" });

export const revertCommand = Command.make("revert", { channelId }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const channel = yield* api.channels.revertBranchRollout({
      path: { id: opts.channelId },
    });
    yield* Console.log(`Reverted rollout on channel "${channel.name}".`);
  }).pipe(handleChannelCommandErrors),
);
