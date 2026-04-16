import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleAnalyticsCommandErrors } from "./helpers";

const channel = Options.text("channel");
const period = Options.choice("period", ["1d", "7d", "30d", "90d"]).pipe(Options.optional);

export const channelsCommand = Command.make("channels", { channel, period }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = Option.match(opts.period, {
      onNone: () => ({}) as Record<string, string>,
      onSome: (p) => ({ period: p }) as Record<string, string>,
    });

    const result = yield* api.analytics.channels({
      urlParams: { projectId, channel: opts.channel, ...periodFilter },
    });

    yield* printKeyValue([
      ["Channel", result.channel],
      ["Total Requests", String(result.totalRequests)],
      ["Unique Devices", String(result.uniqueDevices)],
      ["Manifest", String(result.responseTypeDistribution.manifest)],
      ["Directive", String(result.responseTypeDistribution.directive)],
      ["No Update", String(result.responseTypeDistribution.no_update)],
    ]);
  }).pipe(handleAnalyticsCommandErrors),
);
