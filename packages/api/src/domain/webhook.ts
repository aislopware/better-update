import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id, Name120 } from "./common";

export const WebhookEventName = Schema.Literals(["update.published", "build.completed"]);
export type WebhookEventNameValue = typeof WebhookEventName.Type;

export const Webhook = Schema.Struct({
  id: Id,
  organizationId: Id,
  projectId: Schema.NullOr(Id),
  name: Schema.String,
  url: Schema.String,
  events: Schema.Array(WebhookEventName),
  enabled: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}).annotate({ identifier: "Webhook" });
export type Webhook = typeof Webhook.Type;

export const CreateWebhookBody = Schema.Struct({
  name: Name120,
  url: Schema.String.check(
    Schema.isPattern(/^https?:\/\/.+/u, { message: "URL must start with http:// or https://" }),
    Schema.isMaxLength(2000),
  ),
  events: Schema.Array(WebhookEventName).check(Schema.isMinLength(1)),
  projectId: Schema.optional(Id),
});

export const UpdateWebhookBody = Schema.Struct({
  name: Schema.optional(Name120),
  url: Schema.optional(
    Schema.String.check(
      Schema.isPattern(/^https?:\/\/.+/u, {
        message: "URL must start with http:// or https://",
      }),
      Schema.isMaxLength(2000),
    ),
  ),
  events: Schema.optional(Schema.Array(WebhookEventName).check(Schema.isMinLength(1))),
  enabled: Schema.optional(Schema.Boolean),
});

export const WebhookWithSecret = Schema.Struct({
  ...Webhook.fields,
  secret: Schema.String,
}).annotate({ identifier: "WebhookWithSecret" });
export type WebhookWithSecret = typeof WebhookWithSecret.Type;

export const DeleteWebhookResult = DeletedResult;
