import { safeJsonParse } from "@better-update/safe-json";
import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

export interface WebhookModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly url: string;
  readonly secret: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface WebhookRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string | null;
  readonly name: string;
  readonly url: string;
  readonly secret: string;
  readonly events: string;
  readonly enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
}

const rowToModel = (row: WebhookRow): WebhookModel => {
  const parsed = safeJsonParse(row.events);
  const events = Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    name: row.name,
    url: row.url,
    secret: row.secret,
    events,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export interface WebhookRepository {
  readonly insert: (input: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly name: string;
    readonly url: string;
    readonly secret: string;
    readonly events: readonly string[];
    readonly enabled: boolean;
    readonly createdAt: string;
    readonly updatedAt: string;
  }) => Effect.Effect<void>;
  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly WebhookModel[]>;
  readonly listForEvent: (params: {
    readonly organizationId: string;
    readonly projectId?: string;
    readonly event: string;
  }) => Effect.Effect<readonly WebhookModel[]>;
  readonly findById: (params: { readonly id: string }) => Effect.Effect<WebhookModel, NotFound>;
  readonly update: (params: {
    readonly id: string;
    readonly name?: string;
    readonly url?: string;
    readonly events?: readonly string[];
    readonly enabled?: boolean;
    readonly updatedAt: string;
  }) => Effect.Effect<WebhookModel, NotFound>;
  readonly delete: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<{ readonly deleted: number }>;
}

export class WebhookRepo extends Context.Tag("server/WebhookRepo")<
  WebhookRepo,
  WebhookRepository
>() {}

export const WebhookRepoLive = Layer.succeed(WebhookRepo, {
  insert: (input) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("webhooks")
          .values({
            id: input.id,
            organization_id: input.organizationId,
            project_id: input.projectId,
            name: input.name,
            url: input.url,
            secret: input.secret,
            events: JSON.stringify([...input.events]),
            enabled: input.enabled ? 1 : 0,
            created_at: input.createdAt,
            updated_at: input.updatedAt,
          })
          .execute(),
      );
    }),
  listByOrg: ({ organizationId }) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("webhooks")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(rowToModel);
    }),
  listForEvent: ({ organizationId, projectId, event }) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("webhooks")
          .selectAll()
          .where("organization_id", "=", organizationId)
          .where("enabled", "=", 1)
          .where((eb) =>
            projectId === undefined
              ? eb("project_id", "is", null)
              : eb.or([eb("project_id", "is", null), eb("project_id", "=", projectId)]),
          )
          .execute(),
      );
      return rows.map(rowToModel).filter((webhook) => webhook.events.includes(event));
    }),
  findById: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db.selectFrom("webhooks").selectAll().where("id", "=", id).executeTakeFirst(),
      );
      if (!row) {
        return yield* new NotFound({ message: `Webhook ${id} not found` });
      }
      return rowToModel(row);
    }),
  update: ({ id, name, url, events, enabled, updatedAt }) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const patch = compact({
        name,
        url,
        events: events === undefined ? undefined : JSON.stringify([...events]),
        enabled: enabled === undefined ? undefined : Number(enabled),
        updated_at: updatedAt,
      });
      const row = yield* Effect.promise(async () =>
        db
          .updateTable("webhooks")
          .set(patch)
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirst(),
      );
      if (!row) {
        return yield* new NotFound({ message: `Webhook ${id} not found` });
      }
      return rowToModel(row);
    }),
  delete: ({ id, organizationId }) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .deleteFrom("webhooks")
          .where("id", "=", id)
          .where("organization_id", "=", organizationId)
          .executeTakeFirst(),
      );
      return { deleted: Number(result.numDeletedRows) };
    }),
});
