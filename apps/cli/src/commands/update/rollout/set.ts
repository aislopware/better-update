import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { rolloutPercentageOption } from "../../../lib/cli-schemas";
import { apiClient } from "../../../services/api-client";
import { handleUpdateCommandErrors } from "../helpers";

const updateId = Args.text({ name: "updateId" });
const percentage = rolloutPercentageOption("percentage");

export const setCommand = Command.make("set", { updateId, percentage }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.updates.editRollout({
      path: { id: opts.updateId },
      payload: { percentage: opts.percentage },
    });

    yield* Console.log(
      `Updated rollout for ${opts.updateId} to ${String(result.rolloutPercentage)}%.`,
    );
  }).pipe(handleUpdateCommandErrors),
);
