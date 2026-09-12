import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printKeyValue } from "../../lib/output";
import { periodFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { warnIfUnavailable } from "./unavailable";

export const channelsCommand = Command.make(
  "channels",
  {
    channel: Flag.String("channel").pipe(Flag.withDescription("Channel name")),
    period: periodFlag,
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = args.period ? { period: args.period } : {};

    const result = yield* api.analytics.channels({
      query: { projectId, channel: args.channel, ...periodFilter },
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
).pipe(Command.withDescription("Stats for a specific channel"));
