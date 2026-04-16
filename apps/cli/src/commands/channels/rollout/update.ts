import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../../services/api-client";
import { ChannelCommandError, handleChannelCommandErrors } from "../helpers";

const channelId = Args.text({ name: "channelId" });
const percentage = Options.integer("percentage");

export const updateCommand = Command.make("update", { channelId, percentage }, (opts) =>
  Effect.gen(function* () {
    if (opts.percentage < 1 || opts.percentage > 100) {
      yield* new ChannelCommandError({
        message: "Rollout percentage must be between 1 and 100.",
      });
    }

    const api = yield* apiClient;
    const channel = yield* api.channels.updateBranchRollout({
      path: { id: opts.channelId },
      payload: { percentage: opts.percentage },
    });

    yield* Console.log(
      `Updated rollout on channel "${channel.name}" to ${String(opts.percentage)}%.`,
    );
  }).pipe(handleChannelCommandErrors),
);
