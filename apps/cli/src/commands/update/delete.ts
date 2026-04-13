import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleUpdateCommandErrors } from "./helpers";

const groupId = Args.text({ name: "groupId" });

export const deleteCommand = Command.make("delete", { groupId }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const result = yield* api.updates.deleteGroup({ path: { groupId: opts.groupId } });
    yield* Console.log(`Deleted ${String(result.deleted)} update(s) from group ${opts.groupId}.`);
  }).pipe(handleUpdateCommandErrors),
);
