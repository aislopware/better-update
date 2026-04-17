import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { rolloutPercentageOption } from "../../../lib/cli-schemas";
import { apiClient } from "../../../services/api-client";
import { handleChannelCommandErrors } from "../helpers";

const channelId = Args.text({ name: "channelId" });
const percentage = rolloutPercentageOption("percentage");

export const updateCommand = Command.make("update", { channelId, percentage }, (opts) =>
  Effect.gen(function* () {
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
