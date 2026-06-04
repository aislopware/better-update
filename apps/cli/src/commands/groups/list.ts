import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const listGroupsCommand = defineCommand({
  meta: { name: "list", description: "List member groups in the active organization" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.groups.list();
        yield* printHumanTable(
          ["ID", "Name", "Description", "Created"],
          result.items.map((group) => [
            group.id,
            group.name,
            group.description ?? "-",
            group.createdAt,
          ]),
        );
        return result;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
