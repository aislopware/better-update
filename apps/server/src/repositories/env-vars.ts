import { safeJsonParse } from "@better-update/safe-json";
import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1WithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { EnvVarEnvironment, EnvVarScope, EnvVarVisibility } from "../models";

// -- Row types ---------------------------------------------------------------

interface EnvVarBaseRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string | null;
  readonly scope: EnvVarScope;
  readonly key: string;
  readonly visibility: EnvVarVisibility;
  readonly value: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EnvVarRow extends EnvVarBaseRow {
  readonly environments: readonly EnvVarEnvironment[];
}

interface EnvVarJoinedRow extends EnvVarBaseRow {
  readonly environments_json: string | null;
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
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly scope: EnvVarScope;
    readonly key: string;
    readonly visibility: EnvVarVisibility;
    readonly value: string;
    readonly environments: readonly EnvVarEnvironment[];
  }) => Effect.Effect<EnvVarRow, Conflict>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<EnvVarRow, NotFound>;

  readonly list: (
    filters: EnvVarListFilters,
  ) => Effect.Effect<{ readonly items: readonly EnvVarRow[] }>;

  readonly update: (params: {
    readonly id: string;
    readonly value?: string;
    readonly visibility?: EnvVarVisibility;
  }) => Effect.Effect<EnvVarRow, NotFound>;

  readonly replaceEnvironments: (params: {
    readonly id: string;
    readonly environments: readonly EnvVarEnvironment[];
  }) => Effect.Effect<void, NotFound>;

  readonly deleteById: (params: { readonly id: string }) => Effect.Effect<void, NotFound>;

  readonly countByProject: (params: { readonly projectId: string }) => Effect.Effect<number>;

  readonly countByOrgGlobal: (params: { readonly organizationId: string }) => Effect.Effect<number>;

  readonly upsert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly scope: EnvVarScope;
    readonly key: string;
    readonly visibility: EnvVarVisibility;
    readonly value: string;
    readonly environments: readonly EnvVarEnvironment[];
  }) => Effect.Effect<"created" | "updated">;
}

export class EnvVarRepo extends Context.Tag("api/EnvVarRepo")<EnvVarRepo, EnvVarRepository>() {}

// -- D1 Adapter --------------------------------------------------------------

const BASE_COLUMNS = `v."id", v."organization_id", v."project_id", v."scope", v."key", v."visibility", v."value", v."created_at", v."updated_at"`;

const SELECT_WITH_ENVIRONMENTS = `${BASE_COLUMNS}, (
  SELECT COALESCE(json_group_array(e."environment"), '[]')
  FROM "env_var_environments" e
  WHERE e."env_var_id" = v."id"
) AS "environments_json"`;

const isEnvironment = (value: unknown): value is EnvVarEnvironment =>
  value === "development" || value === "preview" || value === "production";

const parseEnvironments = (raw: string | null): readonly EnvVarEnvironment[] => {
  if (!raw) {
    return [];
  }
  const parsed = safeJsonParse(raw);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return (parsed as readonly unknown[])
    .filter(isEnvironment)
    .toSorted((left, right) => left.localeCompare(right));
};

const toEnvVarRow = (row: EnvVarJoinedRow): EnvVarRow => ({
  id: row.id,
  organization_id: row.organization_id,
  project_id: row.project_id,
  scope: row.scope,
  key: row.key,
  visibility: row.visibility,
  value: row.value,
  created_at: row.created_at,
  updated_at: row.updated_at,
  environments: parseEnvironments(row.environments_json),
});

const escapeLike = (input: string) =>
  input
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);

export const EnvVarRepoLive = Layer.succeed(EnvVarRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "scope", "key", "visibility", "value", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          params.id,
          params.organizationId,
          params.projectId,
          params.scope,
          params.key,
          params.visibility,
          params.value,
          now,
          now,
        ),
        ...params.environments.map((environment) =>
          env.DB.prepare(
            `INSERT INTO "env_var_environments" ("env_var_id", "environment") VALUES (?, ?)`,
          ).bind(params.id, environment),
        ),
      ];

      yield* d1WithUniqueCheck(
        async () => env.DB.batch(statements),
        params.scope === "project"
          ? `Variable "${params.key}" already exists in this project`
          : `Variable "${params.key}" already exists in this organization`,
      );

      return {
        id: params.id,
        organization_id: params.organizationId,
        project_id: params.projectId,
        scope: params.scope,
        key: params.key,
        visibility: params.visibility,
        value: params.value,
        created_at: now,
        updated_at: now,
        environments: [...params.environments].toSorted((left, right) => left.localeCompare(right)),
      };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${SELECT_WITH_ENVIRONMENTS} FROM "env_vars" v WHERE v."id" = ?`)
          .bind(params.id)
          .first<EnvVarJoinedRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }

      return toEnvVarRow(row);
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
        conditions.push('v."project_id" = ?');
        bindValues.push(filters.projectId);
      } else if (filters.scope === "global") {
        conditions.push('v."project_id" IS NULL', 'v."organization_id" = ?');
        bindValues.push(filters.organizationId);
      } else {
        if (filters.projectId) {
          conditions.push(
            '(v."project_id" = ? OR (v."project_id" IS NULL AND v."organization_id" = ?))',
          );
          bindValues.push(filters.projectId, filters.organizationId);
        } else {
          conditions.push('v."organization_id" = ?');
          bindValues.push(filters.organizationId);
        }
      }

      if (filters.environments && filters.environments.length > 0) {
        const placeholders = filters.environments.map(() => "?").join(", ");
        conditions.push(
          `EXISTS (SELECT 1 FROM "env_var_environments" ef WHERE ef."env_var_id" = v."id" AND ef."environment" IN (${placeholders}))`,
        );
        bindValues.push(...filters.environments);
      }

      if (filters.search && filters.search.trim().length > 0) {
        conditions.push(`v."key" LIKE ? ESCAPE '\\'`);
        bindValues.push(`%${escapeLike(filters.search.trim().toUpperCase())}%`);
      }

      const whereClause = conditions.join(" AND ");

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${SELECT_WITH_ENVIRONMENTS} FROM "env_vars" v WHERE ${whereClause} ORDER BY v."key" ASC, v."scope" DESC LIMIT ? OFFSET ?`,
        )
          .bind(...bindValues, filters.limit, filters.offset)
          .all<EnvVarJoinedRow>(),
      );

      return { items: rows.results.map(toEnvVarRow) };
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const setClauses: string[] = ['"updated_at" = ?'];
      const bindValues: (string | number | null)[] = [now];

      if (params.visibility !== undefined) {
        setClauses.push('"visibility" = ?');
        bindValues.push(params.visibility);
      }
      if (params.value !== undefined) {
        setClauses.push('"value" = ?');
        bindValues.push(params.value);
      }

      bindValues.push(params.id);

      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "env_vars" SET ${setClauses.join(", ")} WHERE "id" = ?`)
          .bind(...bindValues)
          .run(),
      );

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${SELECT_WITH_ENVIRONMENTS} FROM "env_vars" v WHERE v."id" = ?`)
          .bind(params.id)
          .first<EnvVarJoinedRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }

      return toEnvVarRow(row);
    }),

  replaceEnvironments: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const exists = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "id" FROM "env_vars" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ id: string }>(),
      );

      if (exists === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }

      const statements: D1PreparedStatement[] = [
        env.DB.prepare(`DELETE FROM "env_var_environments" WHERE "env_var_id" = ?`).bind(params.id),
        ...params.environments.map((environment) =>
          env.DB.prepare(
            `INSERT INTO "env_var_environments" ("env_var_id", "environment") VALUES (?, ?)`,
          ).bind(params.id, environment),
        ),
      ];

      yield* Effect.promise(async () => env.DB.batch(statements));
      return undefined;
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
          ? env.DB.prepare(`SELECT "id" FROM "env_vars" WHERE "project_id" = ? AND "key" = ?`).bind(
              params.projectId,
              params.key,
            )
          : env.DB.prepare(
              `SELECT "id" FROM "env_vars" WHERE "organization_id" = ? AND "project_id" IS NULL AND "key" = ?`,
            ).bind(params.organizationId, params.key)
        ).first<{ id: string }>(),
      );

      const envInserts = (id: string) =>
        params.environments.map((environment) =>
          env.DB.prepare(
            `INSERT INTO "env_var_environments" ("env_var_id", "environment") VALUES (?, ?)`,
          ).bind(id, environment),
        );

      if (existing === null) {
        const statements: D1PreparedStatement[] = [
          env.DB.prepare(
            `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "scope", "key", "visibility", "value", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            params.id,
            params.organizationId,
            params.projectId,
            params.scope,
            params.key,
            params.visibility,
            params.value,
            now,
            now,
          ),
          ...envInserts(params.id),
        ];
        yield* Effect.promise(async () => env.DB.batch(statements));
        return "created" as const;
      }

      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          `UPDATE "env_vars" SET "visibility" = ?, "value" = ?, "updated_at" = ? WHERE "id" = ?`,
        ).bind(params.visibility, params.value, now, existing.id),
        env.DB.prepare(`DELETE FROM "env_var_environments" WHERE "env_var_id" = ?`).bind(
          existing.id,
        ),
        ...envInserts(existing.id),
      ];
      yield* Effect.promise(async () => env.DB.batch(statements));
      return "updated" as const;
    }),
});
