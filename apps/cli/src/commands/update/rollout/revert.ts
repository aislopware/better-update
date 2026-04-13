import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../../services/api-client";
import { handleUpdateCommandErrors } from "../helpers";

const updateId = Args.text({ name: "updateId" });

export const revertCommand = Command.make("revert", { updateId }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.updates.revertRollout({ path: { id: opts.updateId } });
    yield* Console.log(
      `Reverted rollout for ${opts.updateId}. Current rollout is ${String(result.rolloutPercentage)}%.`,
    );
  }).pipe(handleUpdateCommandErrors),
);
