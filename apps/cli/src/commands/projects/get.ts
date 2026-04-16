import { Args, Command } from "@effect/cli";
import { Effect } from "effect";

import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleProjectCommandErrors } from "./helpers";

const id = Args.text({ name: "id" });

export const getCommand = Command.make("get", { id }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const project = yield* api.projects.get({ path: { id: opts.id } });
    yield* printKeyValue([
      ["ID", project.id],
      ["Name", project.name],
      ["Scope Key", project.scopeKey],
      ["Created", project.createdAt],
    ]);
  }).pipe(handleProjectCommandErrors),
);
