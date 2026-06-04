import { compact } from "@better-update/type-guards";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { WebhookRepo } from "../repositories/webhooks";

import type { WebhookModel } from "../repositories/webhooks";

const WEBHOOK_EVENTS = ["update.published", "build.completed"] as const;
type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const isWebhookEvent = (value: string): value is WebhookEvent =>
  (WEBHOOK_EVENTS as readonly string[]).includes(value);

const filterWebhookEvents = (events: readonly string[]): readonly WebhookEvent[] =>
  events.filter(isWebhookEvent);

const toApiWebhook = (model: WebhookModel) => ({
  id: model.id,
  organizationId: model.organizationId,
  projectId: model.projectId,
  name: model.name,
  url: model.url,
  events: filterWebhookEvents(model.events),
  enabled: model.enabled,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

const randomSecret = (): string => {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return [...buf].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const WebhooksGroupLive = HttpApiBuilder.group(ManagementApi, "webhooks", (handlers) =>
  handlers
    .handle("list", () =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("webhook", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* WebhookRepo;
          const items = yield* repo.listByOrg({ organizationId: ctx.organizationId });
          return { items: items.map(toApiWebhook) };
        }),
      ),
    )
    .handle("create", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("webhook", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* WebhookRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          const secret = randomSecret();
          yield* repo.insert({
            id,
            organizationId: ctx.organizationId,
            projectId: toDbNull(payload.projectId),
            name: payload.name,
            url: payload.url,
            secret,
            events: payload.events,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          });
          yield* logAudit({
            action: "webhook.create",
            resourceType: "webhook",
            resourceId: id,
            metadata: { url: payload.url, events: payload.events },
          });
          const model = yield* repo.findById({ id });
          return { ...toApiWebhook(model), secret };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("webhook", "read");
          const repo = yield* WebhookRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);
          return toApiWebhook(model);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("webhook", "update");
          const repo = yield* WebhookRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          const model = yield* repo.update({
            id: path.id,
            updatedAt: new Date().toISOString(),
            ...compact({
              name: payload.name,
              url: payload.url,
              events: payload.events,
              enabled: payload.enabled,
            }),
          });
          yield* logAudit({
            action: "webhook.update",
            resourceType: "webhook",
            resourceId: path.id,
          });
          return toApiWebhook(model);
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("webhook", "delete");
          const ctx = yield* CurrentActor;
          const repo = yield* WebhookRepo;
          // Org-scoped delete: stays idempotent (`deleted: 0` for a missing id)
          // AND closes the cross-org IDOR — another org's webhook id matches 0 rows
          // here, so it is neither leaked nor deletable.
          const result = yield* repo.delete({ id: path.id, organizationId: ctx.organizationId });
          yield* logAudit({
            action: "webhook.delete",
            resourceType: "webhook",
            resourceId: path.id,
          });
          return result;
        }),
      ),
    ),
);
