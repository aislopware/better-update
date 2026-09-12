import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHumanKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const viewCommand = Command.make(
  "view",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Update ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const update = yield* api.updates.get({ params: { id: args.id } });
      yield* printHumanKeyValue([
        ["ID", update.id],
        ["Group ID", update.groupId],
        ["Branch ID", update.branchId],
        ["Platform", update.platform],
        ["Runtime version", update.runtimeVersion],
        ["Rollout %", String(update.rolloutPercentage)],
        ["Is rollback", update.isRollback ? "yes" : "no"],
        ["Created", update.createdAt],
        ["Message", update.message],
      ]);
      return update;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show details for a single update"));
