import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanTable } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const listWebhooksCommand = defineCommand({
  meta: { name: "list", description: "List webhook subscriptions" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { json: "value" },
    ),
});
