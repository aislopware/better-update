import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const ALLOWED_EVENTS = ["update.published", "build.completed"] as const;
type WebhookEvent = (typeof ALLOWED_EVENTS)[number];

const isWebhookEvent = (value: string): value is WebhookEvent =>
  (ALLOWED_EVENTS as readonly string[]).includes(value);

const parseEvents = (raw: string): readonly WebhookEvent[] | { readonly error: string } => {
  const list = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const invalid = list.filter((value) => !isWebhookEvent(value));
  if (invalid.length > 0) {
    return {
      error: `Unknown event(s): ${invalid.join(", ")}. Allowed: ${ALLOWED_EVENTS.join(", ")}`,
    };
  }
  return list.filter(isWebhookEvent);
};

export const createWebhookCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Create a webhook subscription. The signing secret is returned ONCE — store it now.",
  },
  args: {
    name: { type: "string", required: true, description: "Display name" },
    url: { type: "string", required: true, description: "HTTPS URL to POST events to" },
    events: {
      type: "string",
      required: true,
      description: "Comma-separated event names. Allowed: update.published, build.completed",
    },
    "project-id": {
      type: "string",
      description: "Restrict the webhook to a single project (optional)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const parsed = parseEvents(args.events);
        if ("error" in parsed) {
          return yield* new InvalidArgumentError({ message: parsed.error });
        }
        if (parsed.length === 0) {
          return yield* new InvalidArgumentError({
            message: "Pass at least one event via --events",
          });
        }
        const api = yield* apiClient;
        const webhook = yield* api.webhooks.create({
          payload: {
            name: args.name,
            url: args.url,
            events: parsed,
            ...compact({ projectId: args["project-id"] }),
          },
        });
        yield* printHumanKeyValue([
          ["ID", webhook.id],
          ["Name", webhook.name],
          ["URL", webhook.url],
          ["Events", webhook.events.join(",")],
          ["Secret (save now!)", webhook.secret],
        ]);
        return webhook;
      }),
      { json: "value" },
    ),
});
