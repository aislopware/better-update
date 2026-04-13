import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../../services/api-client";
import { UpdateCommandError, handleUpdateCommandErrors } from "../helpers";

const updateId = Args.text({ name: "updateId" });
const percentage = Options.integer("percentage");

export const setCommand = Command.make("set", { updateId, percentage }, (opts) =>
  Effect.gen(function* () {
    if (opts.percentage < 1 || opts.percentage > 100) {
      yield* new UpdateCommandError({
        message: "Rollout percentage must be between 1 and 100.",
      });
    }

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
