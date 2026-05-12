import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

const ALLOWED_EVENTS = ["update.published", "build.completed"] as const;
type WebhookEvent = (typeof ALLOWED_EVENTS)[number];

const isWebhookEvent = (value: string): value is WebhookEvent =>
  (ALLOWED_EVENTS as readonly string[]).includes(value);

const parseEvents = (
  raw: string | undefined,
): readonly WebhookEvent[] | undefined | { readonly error: string } => {
  if (raw === undefined) {
    return undefined;
  }
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

const resolveEnabled = (enable: boolean | undefined, disable: boolean | undefined) => {
  if (enable) {
    return true;
  }
  if (disable) {
    return false;
  }
  return undefined;
};

export const updateWebhookCommand = defineCommand({
  meta: { name: "update", description: "Update webhook fields (name, url, events, enabled)" },
  args: {
    id: { type: "positional", required: true, description: "Webhook ID" },
    name: { type: "string", description: "New display name" },
    url: { type: "string", description: "New URL" },
    events: { type: "string", description: "Replace event list (comma-separated)" },
    enable: { type: "boolean", description: "Mark webhook as enabled" },
    disable: { type: "boolean", description: "Mark webhook as disabled" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const events = parseEvents(args.events);
        if (events && "error" in events) {
          return yield* new InvalidArgumentError({ message: events.error });
        }
        const enabled = resolveEnabled(args.enable, args.disable);
        const api = yield* apiClient;
        const webhook = yield* api.webhooks.update({
          path: { id: args.id },
          payload: {
            ...(args.name === undefined ? {} : { name: args.name }),
            ...(args.url === undefined ? {} : { url: args.url }),
            ...(events === undefined ? {} : { events }),
            ...(enabled === undefined ? {} : { enabled }),
          },
        });
        yield* printKeyValue([
          ["ID", webhook.id],
          ["Name", webhook.name],
          ["URL", webhook.url],
          ["Events", webhook.events.join(",")],
          ["Enabled", webhook.enabled ? "yes" : "no"],
        ]);
        return undefined;
      }),
    ),
});
