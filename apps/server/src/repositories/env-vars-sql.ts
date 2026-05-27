import { Effect } from "effect";

import { NotFound } from "../errors";

import type { EnvVarModel, EnvVarRevisionModel } from "../env-var-models";
import type { EnvVarEnvironment, EnvVarScope, EnvVarVisibility } from "../models";

// SQL plumbing for the env var repository — row types, mappers, statement
// builders, and shared types. Kept beside `env-vars.ts` (which holds the port
// interface + Live adapter) so each file stays under the max-lines budget.

// Keep at most this many revisions per env var. Rotation re-wraps every retained
// revision (one DEK each), so the cap bounds the rotation batch; older revisions
// are pruned when a new one is added, and rollback targets the retained window.
export const REVISION_HISTORY_CAP = 10;

/**
 * A client-sealed value revision. `id` is the UUID the CLI bound as the AAD
 * `credentialId` when sealing, so the server stores it as the revision's key.
 */
export interface EnvVarRevisionInput {
  readonly id: string;
  readonly valueCiphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}

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

/** One env var's active value envelope (for CLI export/build-resolve). */
export interface EnvVarExportRow {
  readonly envVarId: string;
  readonly key: string;
  readonly scope: EnvVarScope;
  readonly environment: EnvVarEnvironment;
  readonly visibility: EnvVarVisibility;
  readonly revisionId: string;
  readonly valueCiphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}

export interface InsertParams {
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly scope: EnvVarScope;
  readonly environment: EnvVarEnvironment;
  readonly key: string;
  readonly visibility: EnvVarVisibility;
  readonly createdByUserId: string | null;
  readonly revision: EnvVarRevisionInput;
}

export interface EnvVarMetaRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string | null;
  readonly scope: EnvVarScope;
  readonly environment: EnvVarEnvironment;
  readonly key: string;
  readonly visibility: EnvVarVisibility;
  readonly current_revision_id: string | null;
  readonly revision_number: number | null;
  readonly revision_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EnvVarRevisionRow {
  readonly id: string;
  readonly env_var_id: string;
  readonly organization_id: string;
  readonly revision_number: number;
  readonly value_ciphertext: string;
  readonly wrapped_dek: string;
  readonly vault_version: number;
  readonly created_by_user_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export const toModel = (row: EnvVarMetaRow): EnvVarModel => ({
  id: row.id,
  organizationId: row.organization_id,
  projectId: row.project_id,
  scope: row.scope,
  environment: row.environment,
  key: row.key,
  visibility: row.visibility,
  currentRevisionId: row.current_revision_id,
  revisionNumber: row.revision_number,
  revisionCount: row.revision_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const toRevisionModel = (row: EnvVarRevisionRow): EnvVarRevisionModel => ({
  id: row.id,
  envVarId: row.env_var_id,
  organizationId: row.organization_id,
  revisionNumber: row.revision_number,
  valueCiphertext: row.value_ciphertext,
  wrappedDek: row.wrapped_dek,
  vaultVersion: row.vault_version,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// `e` = env_vars, `r` = its current revision (LEFT JOIN); `revision_count` is correlated.
export const META_SELECT = `e."id" AS id, e."organization_id" AS organization_id, e."project_id" AS project_id, e."scope" AS scope, e."environment" AS environment, e."key" AS key, e."visibility" AS visibility, e."current_revision_id" AS current_revision_id, e."created_at" AS created_at, e."updated_at" AS updated_at, r."revision_number" AS revision_number, (SELECT COUNT(*) FROM "env_var_revisions" rc WHERE rc."env_var_id" = e."id") AS revision_count`;
export const META_FROM = `FROM "env_vars" e LEFT JOIN "env_var_revisions" r ON r."id" = e."current_revision_id"`;
export const REVISION_COLUMNS = `"id", "env_var_id", "organization_id", "revision_number", "value_ciphertext", "wrapped_dek", "vault_version", "created_by_user_id", "created_at", "updated_at"`;

export const escapeLike = (input: string) =>
  input
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("%", String.raw`\%`)
    .replaceAll("_", String.raw`\_`);

export const conflictMessage = (scope: EnvVarScope, key: string) =>
  scope === "project"
    ? `Variable "${key}" already exists for this environment in this project`
    : `Variable "${key}" already exists for this environment in this organization`;

// -- Statement builders (shared by insert/upsert/addRevision) ----------------

export const insertEnvVarStmt = (
  db: D1Database,
  params: InsertParams & { readonly envVarId: string; readonly now: string },
) =>
  db
    .prepare(
      `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "scope", "environment", "key", "visibility", "current_revision_id", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.envVarId,
      params.organizationId,
      params.projectId,
      params.scope,
      params.environment,
      params.key,
      params.visibility,
      params.revision.id,
      params.now,
      params.now,
    );

export const insertRevisionStmt = (
  db: D1Database,
  params: {
    readonly envVarId: string;
    readonly organizationId: string;
    readonly revisionNumber: number;
    readonly createdByUserId: string | null;
    readonly revision: EnvVarRevisionInput;
    readonly now: string;
  },
) =>
  db
    .prepare(
      `INSERT INTO "env_var_revisions" (${REVISION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.revision.id,
      params.envVarId,
      params.organizationId,
      params.revisionNumber,
      params.revision.valueCiphertext,
      params.revision.wrappedDek,
      params.revision.vaultVersion,
      params.createdByUserId,
      params.now,
      params.now,
    );

export const advancePointerStmt = (
  db: D1Database,
  params: {
    readonly id: string;
    readonly revisionId: string;
    readonly visibility: EnvVarVisibility | undefined;
    readonly now: string;
  },
) =>
  params.visibility === undefined
    ? db
        .prepare(`UPDATE "env_vars" SET "current_revision_id" = ?, "updated_at" = ? WHERE "id" = ?`)
        .bind(params.revisionId, params.now, params.id)
    : db
        .prepare(
          `UPDATE "env_vars" SET "current_revision_id" = ?, "visibility" = ?, "updated_at" = ? WHERE "id" = ?`,
        )
        .bind(params.revisionId, params.visibility, params.now, params.id);

export const pruneStmt = (db: D1Database, envVarId: string, nextNumber: number) =>
  db
    .prepare(`DELETE FROM "env_var_revisions" WHERE "env_var_id" = ? AND "revision_number" <= ?`)
    .bind(envVarId, nextNumber - REVISION_HISTORY_CAP);

/** Fetch the env var metadata model by id, failing `NotFound` if absent. */
export const requireModelById = (db: D1Database, id: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.promise(async () =>
      db
        .prepare(`SELECT ${META_SELECT} ${META_FROM} WHERE e."id" = ?`)
        .bind(id)
        .first<EnvVarMetaRow>(),
    );
    if (row === null) {
      return yield* Effect.fail(new NotFound({ message: "Environment variable not found" }));
    }
    return toModel(row);
  });
