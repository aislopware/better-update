import { Args, Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleBranchCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const deleteCommand = Command.make("delete", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    yield* api.branches.delete({ path: { id: opts.id } });
    yield* Console.log(`Branch ${opts.id} deleted.`);
  }).pipe(handleBranchCommandErrors),
);
