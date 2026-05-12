import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { filterCredentials, listAllCredentials } from "../../lib/credentials-manager";
import { printList } from "../../lib/output";
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

        yield* printList(
          ["ID", "Name", "Platform", "Type", "Distribution"],
          filtered.map((row) => [
            row.id,
            row.name,
            row.platform,
            row.type,
            row.distribution ?? "-",
          ]),
          "No credentials found.",
        );
      }),
    ),
});
