import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const deleteCommand = Command.make(
  "delete",
  {
    groupId: Argument.String("groupId").pipe(Argument.withDescription("Update group ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const result = yield* api.updates.deleteGroup({ params: { groupId: args.groupId } });
      yield* printHuman(`Deleted ${String(result.deleted)} update(s) from group ${args.groupId}.`);
      return { groupId: args.groupId, ...result };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Delete an update group"));
