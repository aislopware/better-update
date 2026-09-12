import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHumanKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
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

export const createWebhookCommand = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(Flag.withDescription("Display name")),
    url: Flag.String("url").pipe(Flag.withDescription("HTTPS URL to POST events to")),
    events: Flag.String("events").pipe(
      Flag.withDescription(
        "Comma-separated event names. Allowed: update.published, build.completed",
      ),
    ),
    "project-id": Flag.String("project-id").pipe(
      Flag.withDescription("Restrict the webhook to a single project (optional)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Create a webhook subscription. The signing secret is returned ONCE — store it now.",
  ),
);
