import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { apiClient } from "../../../services/api-client";

export const revertCommand = Command.make(
  "revert",
  {
    updateId: Argument.String("updateId").pipe(Argument.withDescription("Update ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const result = yield* api.updates.revertRollout({ params: { id: args.updateId } });
      yield* printHuman(
        `Reverted rollout for ${args.updateId}. Current rollout is ${String(result.rolloutPercentage)}%.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Revert the rollout for an update"));
