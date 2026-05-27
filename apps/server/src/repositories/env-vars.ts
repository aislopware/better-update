import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1WithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { EnvVarEnvironment, EnvVarScope, EnvVarVisibility } from "../models";

// -- Row types ---------------------------------------------------------------

// One row per (scope, key, environment): the same key can hold a different value
// in each environment. Uniqueness is enforced by the (scope, key, environment)
// indexes from migration 0048.
export interface EnvVarRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string | null;
  readonly scope: EnvVarScope;
  readonly environment: EnvVarEnvironment;
  readonly key: string;
  readonly visibility: EnvVarVisibility;
  readonly value: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// -- Filter shapes -----------------------------------------------------------

export type EnvVarListScope = "all" | "project" | "global";

export interface EnvVarListFilters {
  readonly organizationId: string;
  readonly projectId?: string;
  readonly scope: EnvVarListScope;
  readonly environments?: readonly EnvVarEnvironment[];
  readonly search?: string;
  readonly limit: number;
  readonly offset: number;
}

// -- Port --------------------------------------------------------------------

export interface EnvVarRepository {
  // Fan out one row per environment, atomically. Fails Conflict if the key
  // already exists in any of the requested environments for this scope.
  readonly insert: (params: {
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly scope: EnvVarScope;
    readonly key: string;
    readonly visibility: EnvVarVisibility;
    readonly value: string;
    readonly environments: readonly EnvVarEnvironment[];
  }) => Effect.Effect<readonly EnvVarRow[], Conflict>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<EnvVarRow, NotFound>;

  readonly list: (
    filters: EnvVarListFilters,
  ) => Effect.Effect<{ readonly items: readonly EnvVarRow[] }>;

  readonly update: (params: {
    readonly id: string;
    readonly value?: string;
    readonly visibility?: EnvVarVisibility;
  }) => Effect.Effect<EnvVarRow, NotFound>;

  readonly deleteById: (params: { readonly id: string }) => Effect.Effect<void, NotFound>;

  readonly countByProject: (params: { readonly projectId: string }) => Effect.Effect<number>;

  readonly countByOrgGlobal: (params: { readonly organizationId: string }) => Effect.Effect<number>;

  // Upsert a single (scope, key, environment) row.
  readonly upsert: (params: {
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly scope: EnvVarScope;
    readonly key: string;
    readonly environment: EnvVarEnvironment;
    readonly visibility: EnvVarVisibility;
    readonly value: string;
  }) => Effect.Effect<"created" | "updated">;
}

export class EnvVarRepo extends Context.Tag("api/EnvVarRepo")<EnvVarRepo, EnvVarRepository>() {}

// -- D1 Adapter --------------------------------------------------------------

const COLUMNS = `"id", "organization_id", "project_id", "scope", "environment", "key", "visibility", "value", "created_at", "updated_at"`;

const escapeLike = (input: string) =>
  input
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);

const conflictMessage = (scope: EnvVarScope, key: string) =>
  scope === "project"
    ? `Variable "${key}" already exists for one of the selected environments in this project`
    : `Variable "${key}" already exists for one of the selected environments in this organization`;

const insertStatement = (
  db: D1Database,
  row: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly scope: EnvVarScope;
    readonly environment: EnvVarEnvironment;
    readonly key: string;
    readonly visibility: EnvVarVisibility;
    readonly value: string;
    readonly now: string;
  },
) =>
  db
    .prepare(`INSERT INTO "env_vars" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      row.id,
      row.organizationId,
      row.projectId,
      row.scope,
      row.environment,
      row.key,
      row.visibility,
      row.value,
      row.now,
      row.now,
    );

export const EnvVarRepoLive = Layer.succeed(EnvVarRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const rows: EnvVarRow[] = params.environments.map((environment) => ({
        id: crypto.randomUUID(),
        organization_id: params.organizationId,
        project_id: params.projectId,
        scope: params.scope,
        environment,
        key: params.key,
        visibility: params.visibility,
        value: params.value,
        created_at: now,
        updated_at: now,
      }));

      const statements = rows.map((row) =>
        insertStatement(env.DB, {
          id: row.id,
          organizationId: row.organization_id,
          projectId: row.project_id,
          scope: row.scope,
          environment: row.environment,
          key: row.key,
          visibility: row.visibility,
          value: params.value,
          now,
        }),
      );

      yield* d1WithUniqueCheck(
        async () => env.DB.batch(statements),
        conflictMessage(params.scope, params.key),
      );

      return rows;
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "env_vars" WHERE "id" = ?`)
          .bind(params.id)
          .first<EnvVarRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }

      return row;
    }),

  list: (filters) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const conditions: string[] = [];
      const bindValues: (string | number)[] = [];

      if (filters.scope === "project") {
        if (!filters.projectId) {
          return { items: [] };
        }
        conditions.push(`"project_id" = ?`);
        bindValues.push(filters.projectId);
      } else if (filters.scope === "global") {
        conditions.push(`"project_id" IS NULL`, `"organization_id" = ?`);
        bindValues.push(filters.organizationId);
      } else {
        if (filters.projectId) {
          conditions.push(`("project_id" = ? OR ("project_id" IS NULL AND "organization_id" = ?))`);
          bindValues.push(filters.projectId, filters.organizationId);
        } else {
          conditions.push(`"organization_id" = ?`);
          bindValues.push(filters.organizationId);
        }
      }

      if (filters.environments && filters.environments.length > 0) {
        const placeholders = filters.environments.map(() => "?").join(", ");
        conditions.push(`"environment" IN (${placeholders})`);
        bindValues.push(...filters.environments);
      }

      if (filters.search && filters.search.trim().length > 0) {
        conditions.push(`"key" LIKE ? ESCAPE '\\'`);
        bindValues.push(`%${escapeLike(filters.search.trim().toUpperCase())}%`);
      }

      const whereClause = conditions.join(" AND ");

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "env_vars" WHERE ${whereClause} ORDER BY "key" ASC, "environment" ASC, "scope" DESC LIMIT ? OFFSET ?`,
        )
          .bind(...bindValues, filters.limit, filters.offset)
          .all<EnvVarRow>(),
      );

      return { items: rows.results };
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const setClauses: string[] = [`"updated_at" = ?`];
      const bindValues: (string | number | null)[] = [now];

      if (params.visibility !== undefined) {
        setClauses.push(`"visibility" = ?`);
        bindValues.push(params.visibility);
      }
      if (params.value !== undefined) {
        setClauses.push(`"value" = ?`);
        bindValues.push(params.value);
      }

      bindValues.push(params.id);

      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "env_vars" SET ${setClauses.join(", ")} WHERE "id" = ?`)
          .bind(...bindValues)
          .run(),
      );

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "env_vars" WHERE "id" = ?`)
          .bind(params.id)
          .first<EnvVarRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }

      return row;
    }),

  deleteById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "env_vars" WHERE "id" = ?`).bind(params.id).run(),
      );

      if (result.meta.changes === 0) {
        yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }
    }),

  countByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT COUNT(*) as count FROM "env_vars" WHERE "project_id" = ?`)
          .bind(params.projectId)
          .first<{ count: number }>(),
      );

      return result?.count ?? 0;
    }),

  countByOrgGlobal: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const result = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "env_vars" WHERE "organization_id" = ? AND "project_id" IS NULL`,
        )
          .bind(params.organizationId)
          .first<{ count: number }>(),
      );

      return result?.count ?? 0;
    }),

  upsert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const existing = yield* Effect.promise(async () =>
        (params.scope === "project"
          ? env.DB.prepare(
              `SELECT "id" FROM "env_vars" WHERE "project_id" = ? AND "key" = ? AND "environment" = ?`,
            ).bind(params.projectId, params.key, params.environment)
          : env.DB.prepare(
              `SELECT "id" FROM "env_vars" WHERE "organization_id" = ? AND "project_id" IS NULL AND "key" = ? AND "environment" = ?`,
            ).bind(params.organizationId, params.key, params.environment)
        ).first<{ id: string }>(),
      );

      if (existing === null) {
        yield* Effect.promise(async () =>
          insertStatement(env.DB, {
            id: crypto.randomUUID(),
            organizationId: params.organizationId,
            projectId: params.projectId,
            scope: params.scope,
            environment: params.environment,
            key: params.key,
            visibility: params.visibility,
            value: params.value,
            now,
          }).run(),
        );
        return "created" as const;
      }

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "env_vars" SET "visibility" = ?, "value" = ?, "updated_at" = ? WHERE "id" = ?`,
        )
          .bind(params.visibility, params.value, now, existing.id)
          .run(),
      );
      return "updated" as const;
    }),
});
