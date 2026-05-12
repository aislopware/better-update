import { defineCommand } from "citty";

import { createWebhookCommand } from "./create";
import { deleteWebhookCommand } from "./delete";
import { listWebhooksCommand } from "./list";
import { updateWebhookCommand } from "./update";
import { viewWebhookCommand } from "./view";

export const webhooksCommand = defineCommand({
  meta: {
    name: "webhooks",
    description: "Manage HTTPS event subscriptions (update.published, build.completed)",
  },
  subCommands: {
    list: listWebhooksCommand,
    create: createWebhookCommand,
    view: viewWebhookCommand,
    update: updateWebhookCommand,
    delete: deleteWebhookCommand,
  },
});
