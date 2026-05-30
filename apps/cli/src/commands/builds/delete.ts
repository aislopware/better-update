import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a build" },
  args: {
    id: { type: "positional", required: true, description: "Build ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api.builds.delete({ path: { id: args.id } });
        yield* printHuman(`Build ${args.id} deleted.`);
        return { id: args.id, deleted: true };
      }),
      { json: "value" },
    ),
});
