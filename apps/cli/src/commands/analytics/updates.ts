import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { readProjectId } from "../../lib/app-json";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { handleAnalyticsCommandErrors } from "./helpers";

const updateId = Options.text("update-id");
const period = Options.choice("period", ["1d", "7d", "30d", "90d"]).pipe(Options.optional);

export const updatesCommand = Command.make("updates", { updateId, period }, (opts) =>
  Effect.gen(function* () {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = Option.match(opts.period, {
      onNone: () => ({}) as Record<string, string>,
      onSome: (p) => ({ period: p }) as Record<string, string>,
    });

    const result = yield* api.analytics.updates({
      urlParams: { projectId, updateId: opts.updateId, ...periodFilter },
    });

    yield* printKeyValue([
      ["Update ID", result.updateId],
      ["Total Requests", String(result.totalRequests)],
      ["Unique Devices", String(result.uniqueDevices)],
      ["Manifest", String(result.byResponseType.manifest)],
      ["Directive", String(result.byResponseType.directive)],
      ["No Update", String(result.byResponseType.no_update)],
    ]);
  }).pipe(handleAnalyticsCommandErrors),
);
