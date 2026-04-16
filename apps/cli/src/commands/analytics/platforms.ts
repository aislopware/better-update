import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleAnalyticsCommandErrors } from "./helpers";

const period = Options.choice("period", ["1d", "7d", "30d", "90d"]).pipe(Options.optional);

export const platformsCommand = Command.make("platforms", { period }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = Option.match(opts.period, {
      onNone: () => ({}) as Record<string, string>,
      onSome: (p) => ({ period: p }) as Record<string, string>,
    });

    const result = yield* api.analytics.platforms({
      urlParams: { projectId, ...periodFilter },
    });

    if (result.platforms.length === 0) {
      yield* Console.log("No platform data found.");
      return;
    }

    yield* printTable(
      ["Platform", "Requests", "Devices"],
      result.platforms.map((p) => [p.platform, String(p.requests), String(p.devices)]),
    );
  }).pipe(handleAnalyticsCommandErrors),
);
