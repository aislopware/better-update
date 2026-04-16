import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleBranchCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });
const name = Options.text("name");

export const renameCommand = Command.make("rename", { id, name }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const branch = yield* api.branches.rename({
      path: { id: opts.id },
      payload: { name: opts.name },
    });
    yield* Console.log(`Branch renamed to "${branch.name}".`);
  }).pipe(handleBranchCommandErrors),
);
