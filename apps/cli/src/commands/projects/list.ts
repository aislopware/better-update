import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleProjectCommandErrors } from "./helpers";

export const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const { items } = yield* api.projects.list({
      urlParams: { page: 1, limit: 1000 },
    });

    if (items.length === 0) {
      yield* Console.log("No projects found.");
      return;
    }

    yield* printTable(
      ["ID", "Name", "Scope Key", "Created"],
      items.map((p) => [p.id, p.name, p.scopeKey, p.createdAt]),
    );
  }).pipe(handleProjectCommandErrors),
);
