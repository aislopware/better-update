import { safeJsonParse } from "@better-update/safe-json";
import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";

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

const COLUMNS = `"id", "organization_id", "project_id", "name", "url", "secret", "events", "enabled", "created_at", "updated_at"`;

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
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`INSERT INTO "webhooks" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(
            input.id,
            input.organizationId,
            input.projectId,
            input.name,
            input.url,
            input.secret,
            JSON.stringify([...input.events]),
            input.enabled ? 1 : 0,
            input.createdAt,
            input.updatedAt,
          )
          .run(),
      );
    }),
  listByOrg: ({ organizationId }) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "webhooks" WHERE "organization_id" = ? ORDER BY "created_at" DESC`,
        )
          .bind(organizationId)
          .all<WebhookRow>(),
      );
      return result.results.map(rowToModel);
    }),
  listForEvent: ({ organizationId, projectId, event }) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "webhooks" WHERE "organization_id" = ? AND "enabled" = 1 AND ("project_id" IS NULL OR "project_id" = ?)`,
        )
          .bind(organizationId, toDbNull(projectId))
          .all<WebhookRow>(),
      );
      return result.results.map(rowToModel).filter((webhook) => webhook.events.includes(event));
    }),
  findById: ({ id }) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "webhooks" WHERE "id" = ?`)
          .bind(id)
          .first<WebhookRow>(),
      );
      if (!row) {
        return yield* new NotFound({ message: `Webhook ${id} not found` });
      }
      return rowToModel(row);
    }),
  update: ({ id, name, url, events, enabled, updatedAt }) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const fields: string[] = [];
      const bindings: (string | number | null)[] = [];
      if (name !== undefined) {
        fields.push(`"name" = ?`);
        bindings.push(name);
      }
      if (url !== undefined) {
        fields.push(`"url" = ?`);
        bindings.push(url);
      }
      if (events !== undefined) {
        fields.push(`"events" = ?`);
        bindings.push(JSON.stringify([...events]));
      }
      if (enabled !== undefined) {
        fields.push(`"enabled" = ?`);
        bindings.push(enabled ? 1 : 0);
      }
      fields.push(`"updated_at" = ?`);
      bindings.push(updatedAt);
      bindings.push(id);
      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "webhooks" SET ${fields.join(", ")} WHERE "id" = ?`)
          .bind(...bindings)
          .run(),
      );
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "webhooks" WHERE "id" = ?`)
          .bind(id)
          .first<WebhookRow>(),
      );
      if (!row) {
        return yield* new NotFound({ message: `Webhook ${id} not found` });
      }
      return rowToModel(row);
    }),
  delete: ({ id, organizationId }) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "webhooks" WHERE "id" = ? AND "organization_id" = ?`)
          .bind(id, organizationId)
          .run(),
      );
      return { deleted: result.meta.changes };
    }),
});
