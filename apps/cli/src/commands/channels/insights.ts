import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { periodFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { warnIfUnavailable } from "../analytics/unavailable";

export const insightsCommand = Command.make(
  "insights",
  {
    name: Argument.String("name").pipe(Argument.withDescription("Channel name")),
    period: periodFlag,
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = args.period ? { period: args.period } : {};
    const result = yield* api.analytics.channels({
      query: { projectId, channel: args.name, ...periodFilter },
    });

    yield* warnIfUnavailable(result.unavailable);
    yield* printKeyValue([
      ["Channel", result.channel],
      ["Total Requests", String(result.totalRequests)],
      ["Unique Devices", String(result.uniqueDevices)],
      ["Manifest", String(result.responseTypeDistribution.manifest)],
      ["Directive", String(result.responseTypeDistribution.directive)],
      ["No Update", String(result.responseTypeDistribution.no_update)],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Show adoption + traffic stats for a channel"));
