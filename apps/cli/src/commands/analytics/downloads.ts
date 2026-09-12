import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { periodFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { warnIfUnavailable } from "./unavailable";

/** "62%", or "—" when nothing was eligible to be patched. */
const patchRate = (patched: number, eligible: number): string =>
  eligible === 0 ? "—" : `${Math.round((patched / eligible) * 100)}%`;

export const downloadsCommand = Command.make(
  "downloads",
  {
    period: periodFlag,
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = args.period ? { period: args.period } : {};

    const result = yield* api.analytics.downloads({
      query: { projectId, ...periodFilter },
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
  }, runCommand()),
).pipe(Command.withDescription("Bundle downloads: patch vs full, bytes served"));
