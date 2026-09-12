import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { printList } from "../../lib/output";
import { periodFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { emptyMessage } from "./unavailable";

export const platformsCommand = Command.make(
  "platforms",
  {
    period: periodFlag,
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = args.period ? { period: args.period } : {};

    const result = yield* api.analytics.platforms({
      query: { projectId, ...periodFilter },
    });

    yield* printList(
      ["Platform", "Requests", "Devices"],
      result.platforms.map((platform) => [
        platform.platform,
        String(platform.requests),
        String(platform.devices),
      ]),
      emptyMessage(result.unavailable, "No platform data found."),
    );
  }, runCommand()),
).pipe(Command.withDescription("Stats by platform"));
