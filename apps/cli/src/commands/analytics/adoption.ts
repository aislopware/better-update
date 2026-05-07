import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const adoptionCommand = defineCommand({
  meta: { name: "adoption", description: "Show update adoption across devices" },
  args: {
    period: { type: "enum", options: ["1d", "7d", "30d", "90d"], description: "Time window" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const periodFilter = args.period ? { period: args.period } : {};

        const result = yield* api.analytics.adoption({
          urlParams: { projectId, ...periodFilter },
        });

        if (result.updates.length === 0) {
          yield* Console.log("No adoption data found.");
          return;
        }

        yield* printTable(
          ["Update ID", "Devices", "First Seen", "Last Seen"],
          result.updates.map((update) => [
            update.updateId,
            String(update.devices),
            update.firstSeen,
            update.lastSeen,
          ]),
        );
      }),
    ),
});
