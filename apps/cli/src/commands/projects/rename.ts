import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";

import { apiClient } from "../../services/api-client";
import { handleProjectCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });
const name = Options.text("name");

export const renameCommand = Command.make("rename", { id, name }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const project = yield* api.projects.rename({
      path: { id: opts.id },
      payload: { name: opts.name },
    });
    yield* Console.log(`Project renamed to "${project.name}".`);
  }).pipe(handleProjectCommandErrors),
);
