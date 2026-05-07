import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const platformsCommand = defineCommand({
  meta: { name: "platforms", description: "Stats by platform" },
  args: {
    period: { type: "enum", options: ["1d", "7d", "30d", "90d"], description: "Time window" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const periodFilter = args.period ? { period: args.period } : {};

        const result = yield* api.analytics.platforms({
          urlParams: { projectId, ...periodFilter },
        });

        if (result.platforms.length === 0) {
          yield* Console.log("No platform data found.");
          return;
        }

        yield* printTable(
          ["Platform", "Requests", "Devices"],
          result.platforms.map((platform) => [
            platform.platform,
            String(platform.requests),
            String(platform.devices),
          ]),
        );
      }),
    ),
});
