import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const updatesCommand = defineCommand({
  meta: { name: "updates", description: "Stats for a specific update" },
  args: {
    "update-id": { type: "string", required: true, description: "Update ID" },
    period: { type: "enum", options: ["1d", "7d", "30d", "90d"], description: "Time window" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const periodFilter = args.period ? { period: args.period } : {};

        const result = yield* api.analytics.updates({
          urlParams: { projectId, updateId: args["update-id"], ...periodFilter },
        });

        yield* printKeyValue([
          ["Update ID", result.updateId],
          ["Total Requests", String(result.totalRequests)],
          ["Unique Devices", String(result.uniqueDevices)],
          ["Manifest", String(result.byResponseType.manifest)],
          ["Directive", String(result.byResponseType.directive)],
          ["No Update", String(result.byResponseType.no_update)],
        ]);
      }),
    ),
});
