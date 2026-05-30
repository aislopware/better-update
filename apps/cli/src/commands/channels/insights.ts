import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras } from "./helpers";

export const insightsCommand = defineCommand({
  meta: { name: "insights", description: "Show adoption + traffic stats for a channel" },
  args: {
    name: { type: "positional", required: true, description: "Channel name" },
    period: { type: "enum", options: ["1d", "7d", "30d", "90d"], description: "Time window" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const periodFilter = args.period ? { period: args.period } : {};
        const result = yield* api.analytics.channels({
          urlParams: { projectId, channel: args.name, ...periodFilter },
        });

        yield* printKeyValue([
          ["Channel", result.channel],
          ["Total Requests", String(result.totalRequests)],
          ["Unique Devices", String(result.uniqueDevices)],
          ["Manifest", String(result.responseTypeDistribution.manifest)],
          ["Directive", String(result.responseTypeDistribution.directive)],
          ["No Update", String(result.responseTypeDistribution.no_update)],
        ]);
      }),
      channelErrorExtras,
    ),
});
