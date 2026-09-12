import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { InvalidArgumentError } from "../../lib/exit-codes";
import { printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
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

export const updateWebhookCommand = Command.make(
  "update",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Webhook ID")),
    name: Flag.String("name").pipe(Flag.withDescription("New display name"), optionalFlag),
    url: Flag.String("url").pipe(Flag.withDescription("New URL"), optionalFlag),
    events: Flag.String("events").pipe(
      Flag.withDescription("Replace event list (comma-separated)"),
      optionalFlag,
    ),
    enable: Flag.Boolean("enable").pipe(
      Flag.withDescription("Mark webhook as enabled"),
      Flag.withDefault(false),
    ),
    disable: Flag.Boolean("disable").pipe(
      Flag.withDescription("Mark webhook as disabled"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(function* (args) {
    const events = parseEvents(args.events);
    if (events && "error" in events) {
      return yield* new InvalidArgumentError({ message: events.error });
    }
    const enabled = resolveEnabled(args.enable, args.disable);
    const api = yield* apiClient;
    const webhook = yield* api.webhooks.update({
      params: { id: args.id },
      payload: compact({
        name: args.name,
        url: args.url,
        events,
        enabled,
      }),
    });
    yield* printKeyValue([
      ["ID", webhook.id],
      ["Name", webhook.name],
      ["URL", webhook.url],
      ["Events", webhook.events.join(",")],
      ["Enabled", webhook.enabled ? "yes" : "no"],
    ]);
    return undefined;
  }, runCommand()),
).pipe(Command.withDescription("Update webhook fields (name, url, events, enabled)"));
