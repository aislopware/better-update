import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

export const deleteWebhookCommand = defineCommand({
  meta: { name: "delete", description: "Delete a webhook subscription" },
  args: {
    id: { type: "positional", required: true, description: "Webhook ID" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(`Delete webhook ${args.id}?`, {
            initialValue: false,
          });
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return;
          }
        }
        const api = yield* apiClient;
        yield* api.webhooks.delete({ path: { id: args.id } });
        yield* printHuman(`Deleted webhook ${args.id}.`);
      }),
    ),
});
