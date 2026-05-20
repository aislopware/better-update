import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateWebhookBody,
  DeleteWebhookResult,
  UpdateWebhookBody,
  Webhook,
  WebhookWithSecret,
} from "../domain/webhook";

export class WebhooksGroup extends HttpApiGroup.make("webhooks")
  .add(
    HttpApiEndpoint.get("list", "/api/webhooks")
      .addSuccess(Schema.Struct({ items: Schema.Array(Webhook) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List webhooks",
          description: "List webhook subscriptions in the active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/webhooks")
      .setPayload(CreateWebhookBody)
      .addSuccess(WebhookWithSecret, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create webhook",
          description:
            "Create a webhook subscription. The `secret` is returned once on creation — store it client-side.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/webhooks/${idParam}`
      .addSuccess(Webhook)
      .annotateContext(
        OpenApi.annotations({ title: "Get webhook", description: "Fetch a single webhook by ID" }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/webhooks/${idParam}`
      .setPayload(UpdateWebhookBody)
      .addSuccess(Webhook)
      .annotateContext(
        OpenApi.annotations({
          title: "Update webhook",
          description: "Update webhook url, events, enabled state, or name",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/webhooks/${idParam}`
      .addSuccess(DeleteWebhookResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete webhook",
          description: "Remove a webhook subscription",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Webhooks",
      description: "User-configured HTTPS event subscriptions",
    }),
  ) {}
