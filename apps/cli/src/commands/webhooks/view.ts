import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { printHumanKeyValue } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

export const viewWebhookCommand = Command.make(
  "view",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Webhook ID")),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const webhook = yield* api.webhooks.get({ params: { id: args.id } });
      yield* printHumanKeyValue([
        ["ID", webhook.id],
        ["Name", webhook.name],
        ["URL", webhook.url],
        ["Events", webhook.events.join(",")],
        ["Enabled", webhook.enabled ? "yes" : "no"],
        ["Project ID", webhook.projectId ?? "(all)"],
        ["Created", webhook.createdAt],
      ]);
      return webhook;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show details for a webhook (without the secret)"));
