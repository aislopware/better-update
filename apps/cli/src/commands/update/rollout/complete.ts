import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../../services/api-client";
import { handleUpdateCommandErrors } from "../helpers";

const updateId = Args.text({ name: "updateId" });

export const completeCommand = Command.make("complete", { updateId }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.updates.completeRollout({ path: { id: opts.updateId } });
    yield* Console.log(
      `Completed rollout for ${opts.updateId}. Current rollout is ${String(result.rolloutPercentage)}%.`,
    );
  }).pipe(handleUpdateCommandErrors),
);
