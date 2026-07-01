import { Context, Effect, Layer } from "effect";

import { d1Batch, kyselyDb } from "../cloudflare/db";
import { Conflict, NotFound } from "../errors";
import {
  advancePointerStmt,
  conflictMessage,
  envVarListWhere,
  insertEnvVarStmt,
  insertRevisionStmt,
  pruneStmt,
  requireModelById,
  revisionColumns,
  selectEnvVarMeta,
  toModel,
  toRevisionModel,
  upsertEnvVarDescription,
} from "./env-vars-sql";

import type { EnvVarModel, EnvVarRevisionModel } from "../env-var-models";
import type { EnvVarEnvironment, EnvVarVisibility } from "../models";
import type {
  EnvVarDescriptionResult,
  EnvVarExportRow,
  EnvVarListFilters,
  InsertParams,
  UpsertDescriptionParams,
} from "./env-vars-sql";

export type {
  EnvVarExportRow,
  EnvVarListFilters,
  EnvVarListScope,
  EnvVarRevisionInput,
} from "./env-vars-sql";

export interface EnvVarRepository {
  /** Create a (scope,key,environment) env var with its first revision, atomically. */
  readonly insertWithRevision: (params: InsertParams) => Effect.Effect<EnvVarModel, Conflict>;
  /** Append a revision, advance the active pointer, prune beyond the cap. */
  readonly addRevision: (params: {
    readonly id: string;
    readonly visibility?: EnvVarVisibility;
    readonly createdByUserId: string | null;
    readonly revision: InsertParams["revision"];
  }) => Effect.Effect<EnvVarModel, NotFound>;
  /** Change the redaction tier only (no new revision). */
  readonly updateVisibility: (params: {
    readonly id: string;
    readonly visibility: EnvVarVisibility;
  }) => Effect.Effect<EnvVarModel, NotFound>;
  /**
   * Upsert a variable's non-secret documentation, keyed by (scope, key) — shared
   * across every environment. Three-state per field (undefined keeps, null clears).
   */
  readonly upsertDescription: (
    params: UpsertDescriptionParams,
  ) => Effect.Effect<EnvVarDescriptionResult>;
  readonly findById: (params: { readonly id: string }) => Effect.Effect<EnvVarModel, NotFound>;
  readonly list: (
    filters: EnvVarListFilters,
  ) => Effect.Effect<{ readonly items: readonly EnvVarModel[] }>;
  /** All revisions of an env var, newest first (history view). */
  readonly listRevisions: (params: {
    readonly envVarId: string;
  }) => Effect.Effect<readonly EnvVarRevisionModel[]>;
  /** Re-point the active value at an existing revision (rollback). */
  readonly rollback: (params: {
    readonly id: string;
    readonly toRevisionId: string;
  }) => Effect.Effect<EnvVarModel, NotFound>;
  readonly deleteById: (params: { readonly id: string }) => Effect.Effect<void, NotFound>;
  readonly countByProject: (params: { readonly projectId: string }) => Effect.Effect<number>;
  readonly countByOrgGlobal: (params: { readonly organizationId: string }) => Effect.Effect<number>;
  /** Upsert a single (scope,key,environment) row from its sealed revision (bulk import). */
  readonly upsert: (params: InsertParams) => Effect.Effect<"created" | "updated">;
  /** The active value envelope for one env var (browser reveal), or NotFound. */
  readonly findCurrentValue: (params: { readonly id: string }) => Effect.Effect<
    {
      readonly id: string;
      readonly ciphertext: string;
      readonly wrappedDek: string;
      readonly vaultVersion: number;
    },
    NotFound
  >;
  /** Env vars for a scope+environment joined with their active value envelope. */
  readonly listForExport: (params: {
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly environment: EnvVarEnvironment;
  }) => Effect.Effect<readonly EnvVarExportRow[]>;
}

export class EnvVarRepo extends Context.Tag("api/EnvVarRepo")<EnvVarRepo, EnvVarRepository>() {}

// -- D1 Adapter -------------------------------------------------------------

export const EnvVarRepoLive = Layer.succeed(EnvVarRepo, {
  insertWithRevision: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      const envVarId = crypto.randomUUID();

      // Insert the env var row + its first revision as one atomic D1 batch (D1
      // has no interactive transactions). A duplicate (scope,key,environment) is
      // a clean Conflict, not a defect: map the UNIQUE rejection (a defect from
      // the failed batch) to a typed 409.
      yield* d1Batch([
        insertEnvVarStmt(db, { ...params, envVarId, now }),
        insertRevisionStmt(db, {
          envVarId,
          organizationId: params.organizationId,
          revisionNumber: 1,
          createdByUserId: params.createdByUserId,
          revision: params.revision,
          now,
        }),
      ]).pipe(
        Effect.catchAllDefect((cause) =>
          String(cause).includes("UNIQUE constraint failed")
            ? Effect.fail(new Conflict({ message: conflictMessage(params.scope, params.key) }))
            : Effect.die(cause),
        ),
      );

      return {
        id: envVarId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        scope: params.scope,
        environment: params.environment,
        key: params.key,
        visibility: params.visibility,
        currentRevisionId: params.revision.id,
        revisionNumber: 1,
        revisionCount: 1,
        // A freshly-created variable has no documentation yet; the create handler
        // merges any provided label/description onto this before mapping.
        label: null,
        description: null,
        createdAt: now,
        updatedAt: now,
      } satisfies EnvVarModel;
    }),

  addRevision: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      const head = yield* Effect.promise(async () =>
        db
          .selectFrom("env_vars as e")
          .leftJoin("env_var_revisions as r", "r.env_var_id", "e.id")
          .where("e.id", "=", params.id)
          .groupBy("e.id")
          .select((eb) => [
            "e.organization_id",
            eb.fn
              .coalesce(eb.fn.max<number | null>("r.revision_number"), eb.lit(0))
              .as("max_number"),
          ])
          .executeTakeFirst(),
      );
      if (head === undefined) {
        return yield* new NotFound({ message: "Environment variable not found" });
      }
      const nextNumber = head.max_number + 1;
      yield* d1Batch([
        insertRevisionStmt(db, {
          envVarId: params.id,
          organizationId: head.organization_id,
          revisionNumber: nextNumber,
          createdByUserId: params.createdByUserId,
          revision: params.revision,
          now,
        }),
        advancePointerStmt(db, {
          id: params.id,
          revisionId: params.revision.id,
          visibility: params.visibility,
          now,
        }),
        pruneStmt(db, params.id, nextNumber),
      ]);
      return yield* requireModelById(db, params.id);
    }),

  updateVisibility: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const updated = yield* Effect.promise(async () =>
        db
          .updateTable("env_vars")
          .set({ visibility: params.visibility, updated_at: new Date().toISOString() })
          .where("id", "=", params.id)
          .returning("id")
          .executeTakeFirst(),
      );
      if (updated === undefined) {
        return yield* new NotFound({ message: "Environment variable not found" });
      }
      return yield* requireModelById(db, params.id);
    }),

  upsertDescription: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      return yield* upsertEnvVarDescription(db, params);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      return yield* requireModelById(db, params.id);
    }),

  list: (filters) =>
    Effect.gen(function* () {
      if (filters.scope === "project" && !filters.projectId) {
        return { items: [] };
      }
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        selectEnvVarMeta(db)
          .where((eb) => envVarListWhere(eb, filters))
          .orderBy("env_vars.key", "asc")
          .orderBy("env_vars.environment", "asc")
          .orderBy("env_vars.scope", "desc")
          .limit(filters.limit)
          .offset(filters.offset)
          .execute(),
      );
      return { items: rows.map(toModel) };
    }),

  listRevisions: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("env_var_revisions")
          .select(revisionColumns)
          .where("env_var_id", "=", params.envVarId)
          .orderBy("revision_number", "desc")
          .execute(),
      );
      return rows.map(toRevisionModel);
    }),

  rollback: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const target = yield* Effect.promise(async () =>
        db
          .selectFrom("env_var_revisions")
          .select("id")
          .where("id", "=", params.toRevisionId)
          .where("env_var_id", "=", params.id)
          .executeTakeFirst(),
      );
      if (target === undefined) {
        return yield* new NotFound({ message: "Revision not found for this environment variable" });
      }
      yield* Effect.promise(async () =>
        db
          .updateTable("env_vars")
          .set({ current_revision_id: params.toRevisionId, updated_at: new Date().toISOString() })
          .where("id", "=", params.id)
          .execute(),
      );
      return yield* requireModelById(db, params.id);
    }),

  deleteById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db.deleteFrom("env_vars").where("id", "=", params.id).executeTakeFirst(),
      );
      if (Number(result.numDeletedRows) === 0) {
        return yield* new NotFound({ message: "Environment variable not found" });
      }
    }),

  countByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .selectFrom("env_vars")
          .where("project_id", "=", params.projectId)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      return result.count;
    }),

  countByOrgGlobal: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .selectFrom("env_vars")
          .where("organization_id", "=", params.organizationId)
          .where("project_id", "is", null)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      return result.count;
    }),

  upsert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      const existing = yield* Effect.promise(async () => {
        const base = db
          .selectFrom("env_vars")
          .select("id")
          .where("key", "=", params.key)
          .where("environment", "=", params.environment);
        if (params.scope === "project") {
          return base.where("project_id", "=", params.projectId).executeTakeFirst();
        }
        return base
          .where("project_id", "is", null)
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst();
      });

      if (existing === undefined) {
        const envVarId = crypto.randomUUID();
        yield* d1Batch([
          insertEnvVarStmt(db, { ...params, envVarId, now }),
          insertRevisionStmt(db, {
            envVarId,
            organizationId: params.organizationId,
            revisionNumber: 1,
            createdByUserId: params.createdByUserId,
            revision: params.revision,
            now,
          }),
        ]);
        return "created" as const;
      }

      const existingId = existing.id;
      const head = yield* Effect.promise(async () =>
        db
          .selectFrom("env_var_revisions")
          .where("env_var_id", "=", existingId)
          .select((eb) =>
            eb.fn.coalesce(eb.fn.max<number | null>("revision_number"), eb.lit(0)).as("max_number"),
          )
          .executeTakeFirst(),
      );
      const nextNumber = (head?.max_number ?? 0) + 1;
      yield* d1Batch([
        insertRevisionStmt(db, {
          envVarId: existingId,
          organizationId: params.organizationId,
          revisionNumber: nextNumber,
          createdByUserId: params.createdByUserId,
          revision: params.revision,
          now,
        }),
        advancePointerStmt(db, {
          id: existingId,
          revisionId: params.revision.id,
          visibility: params.visibility,
          now,
        }),
        pruneStmt(db, existingId, nextNumber),
      ]);
      return "updated" as const;
    }),

  findCurrentValue: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("env_vars as e")
          .innerJoin("env_var_revisions as r", "r.id", "e.current_revision_id")
          .where("e.id", "=", params.id)
          .select(["r.id as revision_id", "r.value_ciphertext", "r.wrapped_dek", "r.vault_version"])
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return yield* new NotFound({ message: "Env var or its value not found" });
      }
      return {
        id: row.revision_id,
        ciphertext: row.value_ciphertext,
        wrappedDek: row.wrapped_dek,
        vaultVersion: row.vault_version,
      };
    }),

  listForExport: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("env_vars as e")
          .innerJoin("env_var_revisions as r", "r.id", "e.current_revision_id")
          .where("e.environment", "=", params.environment)
          .where((eb) =>
            params.projectId === null
              ? eb.and([
                  eb("e.project_id", "is", null),
                  eb("e.organization_id", "=", params.organizationId),
                ])
              : eb.or([
                  eb("e.project_id", "=", params.projectId),
                  eb.and([
                    eb("e.project_id", "is", null),
                    eb("e.organization_id", "=", params.organizationId),
                  ]),
                ]),
          )
          .select([
            "e.id as env_var_id",
            "e.key",
            "e.scope",
            "e.environment",
            "e.visibility",
            "r.id as revision_id",
            "r.value_ciphertext",
            "r.wrapped_dek",
            "r.vault_version",
          ])
          .execute(),
      );

      return rows.map((row) => ({
        envVarId: row.env_var_id,
        key: row.key,
        scope: row.scope,
        environment: row.environment,
        visibility: row.visibility,
        revisionId: row.revision_id,
        valueCiphertext: row.value_ciphertext,
        wrappedDek: row.wrapped_dek,
        vaultVersion: row.vault_version,
      })) satisfies readonly EnvVarExportRow[];
    }),
});
