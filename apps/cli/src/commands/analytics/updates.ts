import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { periodFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { warnIfUnavailable } from "./unavailable";

export const updatesCommand = Command.make(
  "updates",
  {
    "update-id": Flag.String("update-id").pipe(Flag.withDescription("Update ID")),
    period: periodFlag,
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = args.period ? { period: args.period } : {};

    const result = yield* api.analytics.updates({
      query: { projectId, updateId: args["update-id"], ...periodFilter },
    });

    yield* warnIfUnavailable(result.unavailable);
    yield* printKeyValue([
      ["Update ID", result.updateId],
      ["Total Requests", String(result.totalRequests)],
      ["Unique Devices", String(result.uniqueDevices)],
      ["Manifest", String(result.byResponseType.manifest)],
      ["Directive", String(result.byResponseType.directive)],
      ["No Update", String(result.byResponseType.no_update)],
    ]);
  }, runCommand()),
).pipe(Command.withDescription("Stats for a specific update"));
