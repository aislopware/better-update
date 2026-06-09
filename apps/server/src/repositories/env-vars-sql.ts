import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import type { Kysely, Selectable } from "kysely";

import { NotFound } from "../errors";

import type { DB, EnvVarRevisions } from "../db/schema";
import type { EnvVarModel, EnvVarRevisionModel } from "../env-var-models";
import type { EnvVarEnvironment, EnvVarScope, EnvVarVisibility } from "../models";

// Kysely plumbing for the env var repository — row types, mappers, the shared
// metadata projection, and statement builders. Kept beside `env-vars.ts` (which
// holds the port interface + Live adapter) so each file stays under the
// max-lines budget.

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

// Row shape of `selectEnvVarMeta` (the `env_vars` columns plus the two
// scalar-subquery counts), mapped 1:1 by `toModel`.
interface EnvVarMetaRow {
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

export const toRevisionModel = (row: Selectable<EnvVarRevisions>): EnvVarRevisionModel => ({
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

// The list/detail metadata projection. `revision_number` (of the active
// revision) and the correlated `revision_count` are scalar subqueries so the
// source stays a single `env_vars` table — keeping the list filter's
// expression builder simple. Keys map 1:1 onto `EnvVarMetaRow`/`toModel`.
export const selectEnvVarMeta = (db: Kysely<DB>) =>
  db.selectFrom("env_vars").select((eb) => [
    "env_vars.id",
    "env_vars.organization_id",
    "env_vars.project_id",
    "env_vars.scope",
    "env_vars.environment",
    "env_vars.key",
    "env_vars.visibility",
    "env_vars.current_revision_id",
    "env_vars.created_at",
    "env_vars.updated_at",
    eb
      .selectFrom("env_var_revisions as r")
      .whereRef("r.id", "=", "env_vars.current_revision_id")
      .select("r.revision_number")
      .$asScalar()
      .as("revision_number"),
    eb
      .selectFrom("env_var_revisions as rc")
      .whereRef("rc.env_var_id", "=", "env_vars.id")
      .select((count) => count.fn.countAll<number>().as("count"))
      .$asScalar()
      .as("revision_count"),
  ]);

// The revision history projection (every column, mapped 1:1 by `toRevisionModel`).
export const revisionColumns = [
  "id",
  "env_var_id",
  "organization_id",
  "revision_number",
  "value_ciphertext",
  "wrapped_dek",
  "vault_version",
  "created_by_user_id",
  "created_at",
  "updated_at",
] as const;

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
  db: Kysely<DB>,
  params: InsertParams & { readonly envVarId: string; readonly now: string },
) =>
  db.insertInto("env_vars").values({
    id: params.envVarId,
    organization_id: params.organizationId,
    project_id: params.projectId,
    scope: params.scope,
    environment: params.environment,
    key: params.key,
    visibility: params.visibility,
    current_revision_id: params.revision.id,
    created_at: params.now,
    updated_at: params.now,
  });

export const insertRevisionStmt = (
  db: Kysely<DB>,
  params: {
    readonly envVarId: string;
    readonly organizationId: string;
    readonly revisionNumber: number;
    readonly createdByUserId: string | null;
    readonly revision: EnvVarRevisionInput;
    readonly now: string;
  },
) =>
  db.insertInto("env_var_revisions").values({
    id: params.revision.id,
    env_var_id: params.envVarId,
    organization_id: params.organizationId,
    revision_number: params.revisionNumber,
    value_ciphertext: params.revision.valueCiphertext,
    wrapped_dek: params.revision.wrappedDek,
    vault_version: params.revision.vaultVersion,
    created_by_user_id: params.createdByUserId,
    created_at: params.now,
    updated_at: params.now,
  });

export const advancePointerStmt = (
  db: Kysely<DB>,
  params: {
    readonly id: string;
    readonly revisionId: string;
    readonly visibility: EnvVarVisibility | undefined;
    readonly now: string;
  },
) =>
  db
    .updateTable("env_vars")
    // `compact` drops `visibility` when undefined, leaving the pointer-only
    // update (current_revision_id + updated_at always present, never empty).
    .set(
      compact({
        current_revision_id: params.revisionId,
        visibility: params.visibility,
        updated_at: params.now,
      }),
    )
    .where("id", "=", params.id);

export const pruneStmt = (db: Kysely<DB>, envVarId: string, nextNumber: number) =>
  db
    .deleteFrom("env_var_revisions")
    .where("env_var_id", "=", envVarId)
    .where("revision_number", "<=", nextNumber - REVISION_HISTORY_CAP);

/** Fetch the env var metadata model by id, failing `NotFound` if absent. */
export const requireModelById = (db: Kysely<DB>, id: string) =>
  Effect.gen(function* () {
    const row = yield* Effect.promise(async () =>
      selectEnvVarMeta(db).where("env_vars.id", "=", id).executeTakeFirst(),
    );
    if (row === undefined) {
      return yield* new NotFound({ message: "Environment variable not found" });
    }
    return toModel(row);
  });
