import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { drainPages } from "../../lib/drain-cursor";
import { printHumanKeyValue, printHumanTable } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { UpdateCommandError, updateErrorExtras } from "./helpers";

export const insightsCommand = defineCommand({
  meta: {
    name: "insights",
    description: "Show traffic and adoption stats for every update in a group",
  },
  args: {
    groupId: { type: "positional", required: true, description: "Update group ID" },
    period: { type: "enum", options: ["1d", "7d", "30d", "90d"], description: "Time window" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const allUpdates = yield* drainPages((page) =>
          api.updates.list({ urlParams: { projectId, limit: 100, page } }),
        );
        const inGroup = allUpdates.filter((update) => update.groupId === args.groupId);
        if (inGroup.length === 0) {
          return yield* new UpdateCommandError({
            message: `No updates found for group ${args.groupId}.`,
          });
        }

        const periodFilter = args.period ? { period: args.period } : {};
        const stats = yield* Effect.forEach(
          inGroup,
          (update) =>
            api.analytics
              .updates({
                urlParams: { projectId, updateId: update.id, ...periodFilter },
              })
              .pipe(Effect.map((result) => ({ update, result }))),
          { concurrency: 4 },
        );

        const totalRequests = stats.reduce((sum, stat) => sum + stat.result.totalRequests, 0);
        const totalDevices = stats.reduce((sum, stat) => sum + stat.result.uniqueDevices, 0);
        const totalManifest = stats.reduce(
          (sum, stat) => sum + stat.result.byResponseType.manifest,
          0,
        );
        const totalDirective = stats.reduce(
          (sum, stat) => sum + stat.result.byResponseType.directive,
          0,
        );
        const totalNoUpdate = stats.reduce(
          (sum, stat) => sum + stat.result.byResponseType.no_update,
          0,
        );

        yield* printHumanKeyValue([
          ["Group ID", args.groupId],
          ["Updates", String(inGroup.length)],
          ["Total Requests", String(totalRequests)],
          ["Unique Devices (sum)", String(totalDevices)],
          ["Manifest", String(totalManifest)],
          ["Directive", String(totalDirective)],
          ["No Update", String(totalNoUpdate)],
        ]);
        yield* printHumanTable(
          ["Update ID", "Platform", "Requests", "Devices", "Manifest", "Directive", "No Update"],
          stats.map(({ update, result }) => [
            update.id,
            update.platform,
            String(result.totalRequests),
            String(result.uniqueDevices),
            String(result.byResponseType.manifest),
            String(result.byResponseType.directive),
            String(result.byResponseType.no_update),
          ]),
        );
        return {
          groupId: args.groupId,
          updates: inGroup.length,
          totalRequests,
          totalDevices,
          byResponseType: {
            manifest: totalManifest,
            directive: totalDirective,
            no_update: totalNoUpdate,
          },
          items: stats.map(({ update, result }) => ({
            updateId: update.id,
            platform: update.platform,
            totalRequests: result.totalRequests,
            uniqueDevices: result.uniqueDevices,
            byResponseType: result.byResponseType,
          })),
        };
      }),
      { exits: updateErrorExtras, json: "value" },
    ),
});
