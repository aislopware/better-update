import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { printList } from "../../lib/output";
import { periodFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { emptyMessage } from "./unavailable";

export const adoptionCommand = Command.make(
  "adoption",
  {
    period: periodFlag,
  },
  Effect.fn(function* (args) {
    const projectId = yield* readProjectId;
    const api = yield* apiClient;

    const periodFilter = args.period ? { period: args.period } : {};

    const result = yield* api.analytics.adoption({
      query: { projectId, ...periodFilter },
    });

    yield* printList(
      ["Update ID", "Devices", "First Seen", "Last Seen"],
      result.updates.map((update) => [
        update.updateId,
        String(update.devices),
        update.firstSeen,
        update.lastSeen,
      ]),
      emptyMessage(result.unavailable, "No adoption data found."),
    );
  }, runCommand()),
).pipe(Command.withDescription("Show update adoption across devices"));
