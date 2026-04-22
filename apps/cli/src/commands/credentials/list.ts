import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { filterCredentials, listAllCredentials } from "../../lib/credentials-manager";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List credentials across platforms" },
  args: {
    platform: { type: "enum", options: ["ios", "android"], description: "Filter by platform" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const rows = yield* listAllCredentials(api);

        const filtered = filterCredentials(rows, args.platform ? { platform: args.platform } : {});

        if (filtered.length === 0) {
          yield* Console.log("No credentials found.");
          return;
        }

        yield* printTable(
          ["ID", "Name", "Platform", "Type", "Distribution"],
          filtered.map((row) => [
            row.id,
            row.name,
            row.platform,
            row.type,
            row.distribution ?? "-",
          ]),
        );
      }),
    ),
});
