import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const deleteCommand = Command.make(
  "delete",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Build ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      yield* api.builds.delete({ params: { id: args.id } });
      yield* printHuman(`Build ${args.id} deleted.`);
      return { id: args.id, deleted: true };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete a build"));
