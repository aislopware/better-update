import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { parseRolloutPercentage } from "../../../lib/cli-schemas";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { apiClient } from "../../../services/api-client";

export const setCommand = Command.make(
  "set",
  {
    updateId: Argument.String("updateId").pipe(Argument.withDescription("Update ID")),
    percentage: Flag.String("percentage").pipe(Flag.withDescription("Rollout percentage (1-100)")),
  },
  Effect.fn(
    function* (args) {
      const percentage = yield* parseRolloutPercentage(args.percentage, "percentage");
      const api = yield* apiClient;
      const result = yield* api.updates.editRollout({
        params: { id: args.updateId },
        payload: { percentage },
      });

      yield* printHuman(
        `Updated rollout for ${args.updateId} to ${String(result.rolloutPercentage)}%.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Set the rollout percentage for an update"));
