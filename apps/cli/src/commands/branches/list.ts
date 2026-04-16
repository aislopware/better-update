import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleBranchCommandErrors } from "./helpers";

export const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;
    const { items } = yield* api.branches.list({
      urlParams: { projectId, page: 1, limit: 1000 },
    });

    if (items.length === 0) {
      yield* Console.log("No branches found.");
      return;
    }

    yield* printTable(
      ["ID", "Name", "Created"],
      items.map((b) => [b.id, b.name, b.createdAt]),
    );
  }).pipe(handleBranchCommandErrors),
);
