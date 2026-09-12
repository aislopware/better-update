import { Command } from "effect/unstable/cli";

import { createWebhookCommand } from "./create";
import { deleteWebhookCommand } from "./delete";
import { listWebhooksCommand } from "./list";
import { updateWebhookCommand } from "./update";
import { viewWebhookCommand } from "./view";

export const webhooksCommand = Command.make("webhooks").pipe(
  Command.withDescription("Manage HTTPS event subscriptions (update.published, build.completed)"),
  Command.withSubcommands([
    listWebhooksCommand,
    createWebhookCommand,
    viewWebhookCommand,
    updateWebhookCommand,
    deleteWebhookCommand,
  ]),
);
