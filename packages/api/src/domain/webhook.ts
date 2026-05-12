import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const WebhookEventName = Schema.Literal("update.published", "build.completed");
export type WebhookEventNameValue = typeof WebhookEventName.Type;

export class Webhook extends Schema.Class<Webhook>("Webhook")({
  id: Id,
  organizationId: Id,
  projectId: Schema.NullOr(Id),
  name: Schema.String,
  url: Schema.String,
  events: Schema.Array(WebhookEventName),
  enabled: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const CreateWebhookBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  url: Schema.String.pipe(
    Schema.pattern(/^https?:\/\/.+/u, { message: () => "URL must start with http:// or https://" }),
    Schema.maxLength(2000),
  ),
  events: Schema.Array(WebhookEventName).pipe(Schema.minItems(1)),
  projectId: Schema.optional(Id),
});

export const UpdateWebhookBody = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
  url: Schema.optional(
    Schema.String.pipe(
      Schema.pattern(/^https?:\/\/.+/u, {
        message: () => "URL must start with http:// or https://",
      }),
      Schema.maxLength(2000),
    ),
  ),
  events: Schema.optional(Schema.Array(WebhookEventName).pipe(Schema.minItems(1))),
  enabled: Schema.optional(Schema.Boolean),
});

export class WebhookWithSecret extends Schema.Class<WebhookWithSecret>("WebhookWithSecret")({
  ...Webhook.fields,
  secret: Schema.String,
}) {}

export const DeleteWebhookResult = Schema.Struct({ deleted: Schema.Number });
