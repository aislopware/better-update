import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printKeyValue } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { warnIfUnavailable } from "./unavailable";

/** "62%", or "—" when nothing was eligible to be patched. */
const patchRate = (patched: number, eligible: number): string =>
  eligible === 0 ? "—" : `${Math.round((patched / eligible) * 100)}%`;

export const downloadsCommand = defineCommand({
  meta: { name: "downloads", description: "Bundle downloads: patch vs full, bytes served" },
  args: {
    period: { type: "enum", options: ["1d", "7d", "30d", "90d"], description: "Time window" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const periodFilter = args.period ? { period: args.period } : {};

        const result = yield* api.analytics.downloads({
          urlParams: { projectId, ...periodFilter },
        });

        yield* warnIfUnavailable(result.unavailable);
        yield* printKeyValue([
          ["Downloads", String(result.downloads)],
          ["Patch", String(result.patchDownloads)],
          ["Full Bundle", String(result.fullDownloads)],
          ["Not Found", String(result.notFound)],
          ["Bytes Served", String(result.bytesServed)],
          ["Patch Rate", patchRate(result.patchDownloads, result.patchEligibleRequests)],
        ]);
      }),
    ),
});
