import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

import type { CredentialBindingType } from "../models";

// -- Port ------------------------------------------------------------------
// Credential→project bindings (docs/specs/authz/GITLAB-RBAC-SPEC.md §1a/§3c):
// an org-scoped credential is usable in a project only when a binding row
// links them. `appleTeam` bindings cascade to every child credential and the
// team's devices; `ascApiKey` rows exist only for team-less keys; the android
// kinds bind per-row. Unbound credentials are admin-only.
//
// A resource may instead carry an ORG-WIDE binding (`org_credential_binding`,
// migration 0095): bound to every project of the org, present AND future.
// Resolution happens at query time — `boundProjectIds`/`boundProjectIdsByResource`
// expand an org-wide binding into the org's full project-id set, so every
// authz gate and resolver downstream keeps its "is the target project in the
// bound set" shape, and a newly created project is covered with zero writes.

export interface CredentialBindingModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly resourceType: CredentialBindingType;
  readonly resourceId: string;
  readonly createdAt: string;
  /** True when this entry comes from the resource's org-wide binding. */
  readonly allProjects: boolean;
}

export interface OrgCredentialBindingModel {
  readonly id: string;
  readonly organizationId: string;
  readonly resourceType: CredentialBindingType;
  readonly resourceId: string;
  readonly createdAt: string;
}

export interface ProjectCredentialBindingRepository {
  /**
   * Project ids one resource is bound to (per-object gate input). An org-wide
   * binding expands to EVERY project id of the org.
   */
  readonly boundProjectIds: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
  }) => Effect.Effect<readonly string[]>;

  /**
   * resourceId → bound project ids for a whole type (one query per list).
   * Org-wide-bound resources map to the org's full project-id set.
   */
  readonly boundProjectIdsByResource: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
  }) => Effect.Effect<Readonly<Record<string, readonly string[]>>>;

  /** Resource ids of one type carrying an org-wide ("all projects") binding. */
  readonly allProjectsResourceIds: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
  }) => Effect.Effect<readonly string[]>;

  /**
   * Explicit per-project bindings of one project, plus a synthesized entry
   * (`allProjects: true`, `projectId` = the queried project) for every
   * org-wide-bound resource — the project detail view sees the full truth.
   */
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

  /** Idempotent org-wide bind; `true` only when a NEW row was inserted. */
  readonly bindAllProjects: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
    readonly now: string;
  }) => Effect.Effect<boolean>;

  /** Returns `false` when the resource had no org-wide binding. */
  readonly unbindAllProjects: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
  }) => Effect.Effect<boolean>;

  /** The resource's org-wide binding row, or `null` when not org-wide bound. */
  readonly findAllProjectsBinding: (params: {
    readonly organizationId: string;
    readonly resourceType: CredentialBindingType;
    readonly resourceId: string;
  }) => Effect.Effect<OrgCredentialBindingModel | null>;

  /** Drop every binding of one resource — per-project AND org-wide (deletion). */
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
      return yield* Effect.promise(async () => {
        const [explicit, orgWide] = await Promise.all([
          db
            .selectFrom("project_credential_binding")
            .select("project_id")
            .where("organization_id", "=", params.organizationId)
            .where("resource_type", "=", params.resourceType)
            .where("resource_id", "=", params.resourceId)
            .execute(),
          db
            .selectFrom("org_credential_binding")
            .select("id")
            .where("organization_id", "=", params.organizationId)
            .where("resource_type", "=", params.resourceType)
            .where("resource_id", "=", params.resourceId)
            .executeTakeFirst(),
        ]);
        if (orgWide === undefined) {
          return explicit.map((row) => row.project_id);
        }
        const projects = await db
          .selectFrom("projects")
          .select("id")
          .where("organization_id", "=", params.organizationId)
          .execute();
        return [
          ...new Set([...explicit.map((row) => row.project_id), ...projects.map((row) => row.id)]),
        ];
      });
    }),

  boundProjectIdsByResource: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      return yield* Effect.promise(async () => {
        const [explicit, orgWide] = await Promise.all([
          db
            .selectFrom("project_credential_binding")
            .select(["resource_id", "project_id"])
            .where("organization_id", "=", params.organizationId)
            .where("resource_type", "=", params.resourceType)
            .execute(),
          db
            .selectFrom("org_credential_binding")
            .select("resource_id")
            .where("organization_id", "=", params.organizationId)
            .where("resource_type", "=", params.resourceType)
            .execute(),
        ]);
        const byResource = explicit.reduce<Record<string, readonly string[]>>(
          (acc, row) => ({
            ...acc,
            [row.resource_id]: [...(acc[row.resource_id] ?? []), row.project_id],
          }),
          {},
        );
        if (orgWide.length === 0) {
          return byResource;
        }
        const projects = await db
          .selectFrom("projects")
          .select("id")
          .where("organization_id", "=", params.organizationId)
          .execute();
        const allIds = projects.map((row) => row.id);
        return orgWide.reduce(
          (acc, row) => ({
            ...acc,
            [row.resource_id]: [...new Set([...(acc[row.resource_id] ?? []), ...allIds])],
          }),
          byResource,
        );
      });
    }),

  allProjectsResourceIds: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("org_credential_binding")
          .select("resource_id")
          .where("organization_id", "=", params.organizationId)
          .where("resource_type", "=", params.resourceType)
          .execute(),
      );
      return rows.map((row) => row.resource_id);
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const [explicit, orgWide] = yield* Effect.promise(async () =>
        Promise.all([
          db
            .selectFrom("project_credential_binding")
            .selectAll()
            .where("organization_id", "=", params.organizationId)
            .where("project_id", "=", params.projectId)
            .orderBy("created_at", "asc")
            .execute(),
          db
            .selectFrom("org_credential_binding")
            .selectAll()
            .where("organization_id", "=", params.organizationId)
            .orderBy("created_at", "asc")
            .execute(),
        ]),
      );
      // An org-wide binding supersedes an explicit row for the same resource —
      // surface it once, as the org-wide entry.
      const orgWideKeys = new Set(orgWide.map((row) => `${row.resource_type} ${row.resource_id}`));
      return [
        ...explicit
          .filter((row) => !orgWideKeys.has(`${row.resource_type} ${row.resource_id}`))
          .map((row) => ({
            id: row.id,
            organizationId: row.organization_id,
            projectId: row.project_id,
            resourceType: row.resource_type,
            resourceId: row.resource_id,
            createdAt: row.created_at,
            allProjects: false,
          })),
        ...orgWide.map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          projectId: params.projectId,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          createdAt: row.created_at,
          allProjects: true,
        })),
      ];
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

  bindAllProjects: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .insertInto("org_credential_binding")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            resource_type: params.resourceType,
            resource_id: params.resourceId,
            created_at: params.now,
          })
          .onConflict((oc) =>
            oc.columns(["organization_id", "resource_type", "resource_id"]).doNothing(),
          )
          .executeTakeFirst(),
      );
      return Number(result.numInsertedOrUpdatedRows) > 0;
    }),

  unbindAllProjects: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .deleteFrom("org_credential_binding")
          .where("organization_id", "=", params.organizationId)
          .where("resource_type", "=", params.resourceType)
          .where("resource_id", "=", params.resourceId)
          .executeTakeFirst(),
      );
      return Number(result.numDeletedRows) > 0;
    }),

  findAllProjectsBinding: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("org_credential_binding")
          .selectAll()
          .where("organization_id", "=", params.organizationId)
          .where("resource_type", "=", params.resourceType)
          .where("resource_id", "=", params.resourceId)
          .executeTakeFirst(),
      );
      if (row === undefined) {
        return null;
      }
      return {
        id: row.id,
        organizationId: row.organization_id,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        createdAt: row.created_at,
      };
    }),

  removeAllForResource: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        Promise.all([
          db
            .deleteFrom("project_credential_binding")
            .where("organization_id", "=", params.organizationId)
            .where("resource_type", "=", params.resourceType)
            .where("resource_id", "=", params.resourceId)
            .execute(),
          db
            .deleteFrom("org_credential_binding")
            .where("organization_id", "=", params.organizationId)
            .where("resource_type", "=", params.resourceType)
            .where("resource_id", "=", params.resourceId)
            .execute(),
        ]),
      );
    }),
});
