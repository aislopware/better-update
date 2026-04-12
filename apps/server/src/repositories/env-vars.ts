import { NotFound } from "@better-update/api";
import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

// -- Row type ----------------------------------------------------------------

export interface EnvVarRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string;
  readonly environment: string;
  readonly key: string;
  readonly visibility: "plaintext" | "sensitive" | "secret";
  readonly value: string | null;
  readonly encrypted_value: string | null;
  readonly key_version: number | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// -- Port --------------------------------------------------------------------

export interface EnvVarRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly environment: string;
    readonly key: string;
    readonly visibility: "plaintext" | "sensitive" | "secret";
    readonly value: string | null;
    readonly encryptedValue: string | null;
    readonly keyVersion: number | null;
  }) => Effect.Effect<EnvVarRow>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<EnvVarRow, NotFound>;

  readonly list: (params: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly environment?: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly EnvVarRow[]; readonly total: number }>;

  readonly update: (params: {
    readonly id: string;
    readonly value?: string | null;
    readonly encryptedValue?: string | null;
    readonly keyVersion?: number | null;
    readonly visibility?: "plaintext" | "sensitive" | "secret";
  }) => Effect.Effect<EnvVarRow, NotFound>;

  readonly deleteById: (params: { readonly id: string }) => Effect.Effect<void, NotFound>;

  readonly countByProjectEnv: (params: {
    readonly projectId: string;
    readonly environment: string;
  }) => Effect.Effect<number>;

  readonly findAllByProjectEnvs: (params: {
    readonly projectId: string;
    readonly environments: readonly string[];
  }) => Effect.Effect<readonly EnvVarRow[]>;

  readonly upsert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly environment: string;
    readonly key: string;
    readonly visibility: "plaintext" | "sensitive" | "secret";
    readonly value: string | null;
    readonly encryptedValue: string | null;
    readonly keyVersion: number | null;
  }) => Effect.Effect<"created" | "updated">;
}

export class EnvVarRepo extends Context.Tag("api/EnvVarRepo")<EnvVarRepo, EnvVarRepository>() {}

// -- D1 Adapter --------------------------------------------------------------

const SELECT_COLUMNS = `"id", "organization_id", "project_id", "environment", "key", "visibility", "value", "encrypted_value", "key_version", "created_at", "updated_at"`;

export const EnvVarRepoLive = Layer.succeed(EnvVarRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "environment", "key", "visibility", "value", "encrypted_value", "key_version", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.projectId,
            params.environment,
            params.key,
            params.visibility,
            params.value,
            params.encryptedValue,
            params.keyVersion,
            now,
            now,
          )
          .run(),
      );

      return {
        id: params.id,
        organization_id: params.organizationId,
        project_id: params.projectId,
        environment: params.environment,
        key: params.key,
        visibility: params.visibility,
        value: params.value,
        encrypted_value: params.encryptedValue,
        key_version: params.keyVersion,
        created_at: now,
        updated_at: now,
      };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM "env_vars" WHERE "id" = ?`)
          .bind(params.id)
          .first<EnvVarRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }

      return row;
    }),

  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const conditions: string[] = ['"organization_id" = ?', '"project_id" = ?'];
      const bindValues: (string | number)[] = [params.organizationId, params.projectId];

      if (params.environment) {
        conditions.push('"environment" = ?');
        bindValues.push(params.environment);
      }

      const whereClause = conditions.join(" AND ");

      const [countResult, rows] = yield* Effect.promise(async () =>
        Promise.all([
          env.DB.prepare(`SELECT COUNT(*) as count FROM "env_vars" WHERE ${whereClause}`)
            .bind(...bindValues)
            .first<{ count: number }>(),
          env.DB.prepare(
            `SELECT ${SELECT_COLUMNS} FROM "env_vars" WHERE ${whereClause} ORDER BY "key" ASC LIMIT ? OFFSET ?`,
          )
            .bind(...bindValues, params.limit, params.offset)
            .all<EnvVarRow>(),
        ]),
      );

      return { items: rows.results, total: countResult?.count ?? 0 };
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
      if (params.encryptedValue !== undefined) {
        setClauses.push('"encrypted_value" = ?');
        bindValues.push(params.encryptedValue);
      }
      if (params.keyVersion !== undefined) {
        setClauses.push('"key_version" = ?');
        bindValues.push(params.keyVersion);
      }

      bindValues.push(params.id);

      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "env_vars" SET ${setClauses.join(", ")} WHERE "id" = ?`)
          .bind(...bindValues)
          .run(),
      );

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${SELECT_COLUMNS} FROM "env_vars" WHERE "id" = ?`)
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

  countByProjectEnv: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const result = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "env_vars" WHERE "project_id" = ? AND "environment" = ?`,
        )
          .bind(params.projectId, params.environment)
          .first<{ count: number }>(),
      );

      return result?.count ?? 0;
    }),

  findAllByProjectEnvs: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const placeholders = params.environments.map(() => "?").join(", ");

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${SELECT_COLUMNS} FROM "env_vars" WHERE "project_id" = ? AND "environment" IN (${placeholders}) ORDER BY "key" ASC`,
        )
          .bind(params.projectId, ...params.environments)
          .all<EnvVarRow>(),
      );

      return rows.results;
    }),

  upsert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const existing = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id" FROM "env_vars" WHERE "project_id" = ? AND "environment" = ? AND "key" = ?`,
        )
          .bind(params.projectId, params.environment, params.key)
          .first<{ id: string }>(),
      );

      if (existing) {
        yield* Effect.promise(async () =>
          env.DB.prepare(
            `UPDATE "env_vars" SET "visibility" = ?, "value" = ?, "encrypted_value" = ?, "key_version" = ?, "updated_at" = ? WHERE "id" = ?`,
          )
            .bind(
              params.visibility,
              params.value,
              params.encryptedValue,
              params.keyVersion,
              now,
              existing.id,
            )
            .run(),
        );
        return "updated" as const;
      }

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "environment", "key", "visibility", "value", "encrypted_value", "key_version", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.projectId,
            params.environment,
            params.key,
            params.visibility,
            params.value,
            params.encryptedValue,
            params.keyVersion,
            now,
            now,
          )
          .run(),
      );
      return "created" as const;
    }),
});
