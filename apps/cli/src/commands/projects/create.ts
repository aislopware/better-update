import { Command, Options } from "@effect/cli";
import { Effect } from "effect";

import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleProjectCommandErrors } from "./helpers";

const name = Options.text("name");
const scopeKey = Options.text("scope-key");

export const createCommand = Command.make("create", { name, scopeKey }, (opts) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const project = yield* api.projects.create({
      payload: { name: opts.name, scopeKey: opts.scopeKey },
    });
    yield* printKeyValue([
      ["ID", project.id],
      ["Name", project.name],
      ["Scope Key", project.scopeKey],
      ["Created", project.createdAt],
    ]);
  }).pipe(handleProjectCommandErrors),
);
