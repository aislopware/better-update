import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1WithUniqueCheck } from "./d1-helpers";
import {
  advancePointerStmt,
  conflictMessage,
  escapeLike,
  insertEnvVarStmt,
  insertRevisionStmt,
  META_FROM,
  META_SELECT,
  pruneStmt,
  REVISION_COLUMNS,
  requireModelById,
  toModel,
  toRevisionModel,
} from "./env-vars-sql";

import type { EnvVarModel, EnvVarRevisionModel } from "../env-var-models";
import type { Conflict } from "../errors";
import type { EnvVarEnvironment, EnvVarScope, EnvVarVisibility } from "../models";
import type {
  EnvVarExportRow,
  EnvVarListFilters,
  EnvVarMetaRow,
  EnvVarRevisionRow,
  InsertParams,
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
  /** Env vars for a scope+environment joined with their active value envelope. */
  readonly listForExport: (params: {
    readonly organizationId: string;
    readonly projectId: string | null;
    readonly environment: EnvVarEnvironment;
  }) => Effect.Effect<readonly EnvVarExportRow[]>;
}

export class EnvVarRepo extends Context.Tag("api/EnvVarRepo")<EnvVarRepo, EnvVarRepository>() {}

export const EnvVarRepoLive = Layer.succeed(EnvVarRepo, {
  insertWithRevision: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      const envVarId = crypto.randomUUID();
      yield* d1WithUniqueCheck(
        async () =>
          env.DB.batch([
            insertEnvVarStmt(env.DB, { ...params, envVarId, now }),
            insertRevisionStmt(env.DB, {
              envVarId,
              organizationId: params.organizationId,
              revisionNumber: 1,
              createdByUserId: params.createdByUserId,
              revision: params.revision,
              now,
            }),
          ]),
        conflictMessage(params.scope, params.key),
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
        createdAt: now,
        updatedAt: now,
      } satisfies EnvVarModel;
    }),

  addRevision: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      const head = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT e."organization_id" AS organization_id, COALESCE(MAX(r."revision_number"), 0) AS max_number FROM "env_vars" e LEFT JOIN "env_var_revisions" r ON r."env_var_id" = e."id" WHERE e."id" = ? GROUP BY e."id"`,
        )
          .bind(params.id)
          .first<{ organization_id: string; max_number: number }>(),
      );
      if (head === null) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }
      const nextNumber = head.max_number + 1;
      yield* Effect.promise(async () =>
        env.DB.batch([
          insertRevisionStmt(env.DB, {
            envVarId: params.id,
            organizationId: head.organization_id,
            revisionNumber: nextNumber,
            createdByUserId: params.createdByUserId,
            revision: params.revision,
            now,
          }),
          advancePointerStmt(env.DB, {
            id: params.id,
            revisionId: params.revision.id,
            visibility: params.visibility,
            now,
          }),
          pruneStmt(env.DB, params.id, nextNumber),
        ]),
      );
      return yield* requireModelById(env.DB, params.id);
    }),

  updateVisibility: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "env_vars" SET "visibility" = ?, "updated_at" = ? WHERE "id" = ?`)
          .bind(params.visibility, new Date().toISOString(), params.id)
          .run(),
      );
      if (result.meta.changes === 0) {
        return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
      }
      return yield* requireModelById(env.DB, params.id);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* requireModelById(env.DB, params.id);
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
        conditions.push(`e."project_id" = ?`);
        bindValues.push(filters.projectId);
      } else if (filters.scope === "global") {
        conditions.push(`e."project_id" IS NULL`, `e."organization_id" = ?`);
        bindValues.push(filters.organizationId);
      } else if (filters.projectId) {
        conditions.push(
          `(e."project_id" = ? OR (e."project_id" IS NULL AND e."organization_id" = ?))`,
        );
        bindValues.push(filters.projectId, filters.organizationId);
      } else {
        conditions.push(`e."organization_id" = ?`);
        bindValues.push(filters.organizationId);
      }

      if (filters.environments && filters.environments.length > 0) {
        conditions.push(`e."environment" IN (${filters.environments.map(() => "?").join(", ")})`);
        bindValues.push(...filters.environments);
      }
      if (filters.search && filters.search.trim().length > 0) {
        conditions.push(`e."key" LIKE ? ESCAPE '\\'`);
        bindValues.push(`%${escapeLike(filters.search.trim().toUpperCase())}%`);
      }

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${META_SELECT} ${META_FROM} WHERE ${conditions.join(" AND ")} ORDER BY e."key" ASC, e."environment" ASC, e."scope" DESC LIMIT ? OFFSET ?`,
        )
          .bind(...bindValues, filters.limit, filters.offset)
          .all<EnvVarMetaRow>(),
      );
      return { items: rows.results.map(toModel) };
    }),

  listRevisions: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${REVISION_COLUMNS} FROM "env_var_revisions" WHERE "env_var_id" = ? ORDER BY "revision_number" DESC`,
        )
          .bind(params.envVarId)
          .all<EnvVarRevisionRow>(),
      );
      return rows.results.map(toRevisionModel);
    }),

  rollback: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const target = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "id" FROM "env_var_revisions" WHERE "id" = ? AND "env_var_id" = ?`)
          .bind(params.toRevisionId, params.id)
          .first<{ id: string }>(),
      );
      if (target === null) {
        return yield* Effect.fail(
          new NotFound({ message: "Revision not found for this environment variable" }),
        );
      }
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "env_vars" SET "current_revision_id" = ?, "updated_at" = ? WHERE "id" = ?`,
        )
          .bind(params.toRevisionId, new Date().toISOString(), params.id)
          .run(),
      );
      return yield* requireModelById(env.DB, params.id);
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
        const envVarId = crypto.randomUUID();
        yield* Effect.promise(async () =>
          env.DB.batch([
            insertEnvVarStmt(env.DB, { ...params, envVarId, now }),
            insertRevisionStmt(env.DB, {
              envVarId,
              organizationId: params.organizationId,
              revisionNumber: 1,
              createdByUserId: params.createdByUserId,
              revision: params.revision,
              now,
            }),
          ]),
        );
        return "created" as const;
      }

      const head = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COALESCE(MAX("revision_number"), 0) AS max_number FROM "env_var_revisions" WHERE "env_var_id" = ?`,
        )
          .bind(existing.id)
          .first<{ max_number: number }>(),
      );
      const nextNumber = (head?.max_number ?? 0) + 1;
      yield* Effect.promise(async () =>
        env.DB.batch([
          insertRevisionStmt(env.DB, {
            envVarId: existing.id,
            organizationId: params.organizationId,
            revisionNumber: nextNumber,
            createdByUserId: params.createdByUserId,
            revision: params.revision,
            now,
          }),
          advancePointerStmt(env.DB, {
            id: existing.id,
            revisionId: params.revision.id,
            visibility: params.visibility,
            now,
          }),
          pruneStmt(env.DB, existing.id, nextNumber),
        ]),
      );
      return "updated" as const;
    }),

  listForExport: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const scopeClause =
        params.projectId === null
          ? `e."project_id" IS NULL AND e."organization_id" = ?`
          : `(e."project_id" = ? OR (e."project_id" IS NULL AND e."organization_id" = ?))`;
      const scopeBinds =
        params.projectId === null
          ? [params.organizationId]
          : [params.projectId, params.organizationId];

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT e."id" AS env_var_id, e."key" AS key, e."scope" AS scope, e."environment" AS environment, e."visibility" AS visibility, r."id" AS revision_id, r."value_ciphertext" AS value_ciphertext, r."wrapped_dek" AS wrapped_dek, r."vault_version" AS vault_version FROM "env_vars" e JOIN "env_var_revisions" r ON r."id" = e."current_revision_id" WHERE e."environment" = ? AND ${scopeClause}`,
        )
          .bind(params.environment, ...scopeBinds)
          .all<{
            env_var_id: string;
            key: string;
            scope: EnvVarScope;
            environment: EnvVarEnvironment;
            visibility: EnvVarVisibility;
            revision_id: string;
            value_ciphertext: string;
            wrapped_dek: string;
            vault_version: number;
          }>(),
      );

      return rows.results.map((row) => ({
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
