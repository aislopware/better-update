import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

export const WebhooksGroup = HttpApiGroup.make("webhooks")
  .add(
    HttpApiEndpoint.get("list", "/api/webhooks", {
      success: Schema.Struct({ items: Schema.Array(Webhook) }),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List webhooks",
        description: "List webhook subscriptions in the active organization",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/webhooks", {
      payload: CreateWebhookBody,
      success: WebhookWithSecret.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create webhook",
        description:
          "Create a webhook subscription. The `secret` is returned once on creation — store it client-side.",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/webhooks/:id", {
      params: { ...idParam },
      success: Webhook,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({ title: "Get webhook", description: "Fetch a single webhook by ID" }),
    ),
    HttpApiEndpoint.patch("update", "/api/webhooks/:id", {
      params: { ...idParam },
      payload: UpdateWebhookBody,
      success: Webhook,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update webhook",
        description: "Update webhook url, events, enabled state, or name",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/webhooks/:id", {
      params: { ...idParam },
      success: DeleteWebhookResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete webhook",
        description: "Remove a webhook subscription",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Webhooks",
      description: "User-configured HTTPS event subscriptions",
    }),
  );
