import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printJson, printKeyValue } from "../../lib/output";
import { OutputMode } from "../../lib/output-mode";
import { apiClient } from "../../services/api-client";

export const viewWebhookCommand = defineCommand({
  meta: { name: "view", description: "Show details for a webhook (without the secret)" },
  args: {
    id: { type: "positional", required: true, description: "Webhook ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const webhook = yield* api.webhooks.get({ path: { id: args.id } });
        const mode = yield* OutputMode;
        if (mode.json) {
          yield* printJson(webhook);
          return undefined;
        }
        yield* printKeyValue([
          ["ID", webhook.id],
          ["Name", webhook.name],
          ["URL", webhook.url],
          ["Events", webhook.events.join(",")],
          ["Enabled", webhook.enabled ? "yes" : "no"],
          ["Project ID", webhook.projectId ?? "(all)"],
          ["Created", webhook.createdAt],
        ]);
        return undefined;
      }),
    ),
});
