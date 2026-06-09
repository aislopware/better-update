import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Selectable } from "kysely";

import { d1Session } from "../cloudflare/context";
import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Environments } from "../db/schema";
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

const ENVIRONMENT_COLUMNS = ["id", "organization_id", "name", "created_at"] as const;

const toEnvironment = (row: Selectable<Environments>) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    createdAt: row.created_at,
  }) satisfies EnvironmentModel;

export const EnvironmentRepoLive = Layer.succeed(EnvironmentRepo, {
  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("environments")
          .select(ENVIRONMENT_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .orderBy(sql`"name" collate nocase`, "asc")
          .execute(),
      );
      return rows.map(toEnvironment);
    }),

  findByName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("environments")
          .select(ENVIRONMENT_COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("name", "=", params.name)
          .executeTakeFirst(),
      );
      if (!row) {
        return yield* new NotFound({ message: "Environment not found" });
      }
      return toEnvironment(row);
    }),

  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("environments")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              name: params.name,
              created_at: params.createdAt,
            })
            .execute(),
        `An environment named "${params.name}" already exists`,
      );
    }),

  rename: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const session = yield* d1Session;
      const now = new Date().toISOString();

      // Rename + re-point run as one atomic D1 batch (D1 has no interactive
      // transactions) so a name collision rolls the rename back too. d1Batch
      // can't carry the typed Conflict, so the batch is routed through the
      // unique-check helper here.
      yield* d1RunWithUniqueCheck(async () => {
        const statements = [
          db
            .updateTable("environments")
            .set({ name: params.newName })
            .where("organization_id", "=", params.organizationId)
            .where("name", "=", params.oldName),
          db
            .updateTable("env_vars")
            .set({ environment: params.newName, updated_at: now })
            .where("organization_id", "=", params.organizationId)
            .where("environment", "=", params.oldName),
        ].map((query) => {
          const { sql: compiledSql, parameters } = query.compile();
          return session.prepare(compiledSql).bind(...parameters);
        });
        return session.batch(statements);
      }, `An environment named "${params.newName}" already exists`);
    }),

  countEnvVarsUsing: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("env_vars")
          .where("organization_id", "=", params.organizationId)
          .where("environment", "=", params.name)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      return countRow.count;
    }),

  deleteByName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("environments")
          .where("organization_id", "=", params.organizationId)
          .where("name", "=", params.name)
          .execute(),
      );
    }),
});
