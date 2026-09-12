import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { printHumanTable } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const listWebhooksCommand = Command.make(
  "list",
  {},
  Effect.fn(
    function* () {
      const api = yield* apiClient;
      const result = yield* api.webhooks.list();
      yield* printHumanTable(
        ["ID", "Name", "URL", "Events", "Enabled"],
        result.items.map((webhook) => [
          webhook.id,
          webhook.name,
          webhook.url,
          webhook.events.join(","),
          webhook.enabled ? "yes" : "no",
        ]),
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List webhook subscriptions"));
