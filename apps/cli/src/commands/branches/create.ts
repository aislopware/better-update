import { Command, Options } from "@effect/cli";
import { Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleBranchCommandErrors } from "./helpers";

const name = Options.text("name");

export const createCommand = Command.make("create", { name }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const branch = yield* api.branches.create({
      payload: { projectId, name: opts.name },
    });
    yield* printKeyValue([
      ["ID", branch.id],
      ["Name", branch.name],
      ["Created", branch.createdAt],
    ]);
  }).pipe(handleBranchCommandErrors),
);
