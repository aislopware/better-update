import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

import type { CredentialBindingType } from "../models";

// -- Port ------------------------------------------------------------------
// Credential→project bindings (docs/specs/authz/GITLAB-RBAC-SPEC.md §1a/§3c):
// an org-scoped credential is usable in a project only when a binding row
// links them. `appleTeam` bindings cascade to every child credential and the
// team's devices; `ascApiKey` rows exist only for team-less keys; the android
// kinds bind per-row. Unbound credentials are admin-only.

export interface CredentialBindingModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly resourceType: CredentialBindingType;
  readonly resourceId: string;
  readonly createdAt: string;
}

export interface ProjectCredentialBindingRepository {
  /** Project ids one resource is bound to (per-object gate input). */
  readonly boundProjectIds: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
  }) => Effect.Effect<readonly string[]>;

  /** resourceId → bound project ids for a whole type (one query per list). */
  readonly boundProjectIdsByResource: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
  }) => Effect.Effect<Readonly<Record<string, readonly string[]>>>;

  readonly listByProject: (params: {
    readonly organizationId: string;
    readonly projectId: string;
  }) => Effect.Effect<readonly CredentialBindingModel[]>;

  /**
   * Idempotent: an existing (project, type, id) binding is left untouched.
   * Returns `true` only when a NEW row was inserted (callers audit on it).
   */
  readonly bind: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
    readonly now: string;
  }) => Effect.Effect<boolean>;

  /** Returns `false` when no binding matched. */
  readonly unbind: (params: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
  }) => Effect.Effect<boolean>;

  /** Drop every binding of one resource (credential/team deletion). */
  readonly removeAllForResource: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
  }) => Effect.Effect<void>;
}

export class ProjectCredentialBindingRepo extends Context.Tag("api/ProjectCredentialBindingRepo")<
  ProjectCredentialBindingRepo,
  ProjectCredentialBindingRepository
>() {}

// -- D1 Adapter --------------------------------------------------------------

export const ProjectCredentialBindingRepoLive = Layer.succeed(ProjectCredentialBindingRepo, {
  boundProjectIds: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("project_credential_binding")
          .select("project_id")
          .where("organization_id", "=", params.organizationId)
          .where("resource_type", "=", params.resourceType)
          .where("resource_id", "=", params.resourceId)
          .execute(),
      );
      return rows.map((row) => row.project_id);
    }),

  boundProjectIdsByResource: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("project_credential_binding")
          .select(["resource_id", "project_id"])
          .where("organization_id", "=", params.organizationId)
          .where("resource_type", "=", params.resourceType)
          .execute(),
      );
      return rows.reduce<Record<string, readonly string[]>>(
        (byResource, row) => ({
          ...byResource,
          [row.resource_id]: [...(byResource[row.resource_id] ?? []), row.project_id],
        }),
        {},
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("project_credential_binding")
          .selectAll()
          .where("organization_id", "=", params.organizationId)
          .where("project_id", "=", params.projectId)
          .orderBy("created_at", "asc")
          .execute(),
      );
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organization_id,
        projectId: row.project_id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        createdAt: row.created_at,
      }));
    }),

  bind: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .insertInto("project_credential_binding")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            project_id: params.projectId,
            resource_type: params.resourceType,
            resource_id: params.resourceId,
            created_at: params.now,
          })
          .onConflict((oc) =>
            oc.columns(["project_id", "resource_type", "resource_id"]).doNothing(),
          )
          .executeTakeFirst(),
      );
      return Number(result.numInsertedOrUpdatedRows) > 0;
    }),

  unbind: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .deleteFrom("project_credential_binding")
          .where("organization_id", "=", params.organizationId)
          .where("project_id", "=", params.projectId)
          .where("resource_type", "=", params.resourceType)
          .where("resource_id", "=", params.resourceId)
          .executeTakeFirst(),
      );
      return Number(result.numDeletedRows) > 0;
    }),

  removeAllForResource: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("project_credential_binding")
          .where("organization_id", "=", params.organizationId)
          .where("resource_type", "=", params.resourceType)
          .where("resource_id", "=", params.resourceId)
          .execute(),
      );
    }),
});
