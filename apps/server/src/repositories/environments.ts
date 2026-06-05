import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { EnvironmentModel } from "../models";

// -- Port ------------------------------------------------------------------

export interface EnvironmentRepository {
  /** User-defined environments for an org (built-ins are virtual, added by the handler). */
  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly EnvironmentModel[]>;

  readonly findByName: (params: {
    readonly organizationId: string;
    readonly name: string;
  }) => Effect.Effect<EnvironmentModel, NotFound>;

  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  /**
   * Rename a user-defined environment and re-point every env var bound to the
   * old name, atomically. A unique collision (a var already exists at the target
   * name with the same key) surfaces as Conflict.
   */
  readonly rename: (params: {
    readonly organizationId: string;
    readonly oldName: string;
    readonly newName: string;
  }) => Effect.Effect<void, Conflict>;

  /** Count env vars (project + global) in the org bound to an environment name. */
  readonly countEnvVarsUsing: (params: {
    readonly organizationId: string;
    readonly name: string;
  }) => Effect.Effect<number>;

  readonly deleteByName: (params: {
    readonly organizationId: string;
    readonly name: string;
  }) => Effect.Effect<void>;
}

export class EnvironmentRepo extends Context.Tag("api/EnvironmentRepo")<
  EnvironmentRepo,
  EnvironmentRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

interface EnvironmentRow {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
}

const ENVIRONMENT_COLUMNS = `"id", "organization_id", "name", "created_at"`;

const toEnvironment = (row: EnvironmentRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    createdAt: row.created_at,
  }) satisfies EnvironmentModel;

export const EnvironmentRepoLive = Layer.succeed(EnvironmentRepo, {
  listByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${ENVIRONMENT_COLUMNS} FROM "environments" WHERE "organization_id" = ? ORDER BY "name" COLLATE NOCASE ASC`,
        )
          .bind(params.organizationId)
          .all<EnvironmentRow>(),
      );
      return rows.results.map(toEnvironment);
    }),

  findByName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${ENVIRONMENT_COLUMNS} FROM "environments" WHERE "organization_id" = ? AND "name" = ?`,
        )
          .bind(params.organizationId, params.name)
          .first<EnvironmentRow>(),
      );
      if (row === null) {
        return yield* new NotFound({ message: "Environment not found" });
      }
      return toEnvironment(row);
    }),

  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "environments" ("id", "organization_id", "name", "created_at") VALUES (?, ?, ?, ?)`,
          )
            .bind(params.id, params.organizationId, params.name, params.createdAt)
            .run(),
        `An environment named "${params.name}" already exists`,
      );
    }),

  rename: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.batch([
            env.DB.prepare(
              `UPDATE "environments" SET "name" = ? WHERE "organization_id" = ? AND "name" = ?`,
            ).bind(params.newName, params.organizationId, params.oldName),
            env.DB.prepare(
              `UPDATE "env_vars" SET "environment" = ?, "updated_at" = ? WHERE "organization_id" = ? AND "environment" = ?`,
            ).bind(params.newName, now, params.organizationId, params.oldName),
          ]),
        `An environment named "${params.newName}" already exists`,
      );
    }),

  countEnvVarsUsing: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "env_vars" WHERE "organization_id" = ? AND "environment" = ?`,
        )
          .bind(params.organizationId, params.name)
          .first<{ count: number }>(),
      );
      return result?.count ?? 0;
    }),

  deleteByName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "environments" WHERE "organization_id" = ? AND "name" = ?`)
          .bind(params.organizationId, params.name)
          .run(),
      );
    }),
});
