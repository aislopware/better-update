import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

import type { ProjectPrincipalType, ProjectRole } from "../models";

// -- Port ------------------------------------------------------------------
// Project membership (docs/specs/authz/GITLAB-RBAC-SPEC.md §1/§4a): one row
// per org member per project, carrying the fixed project role (robots hold
// theirs on `robot_account`, §1b). The per-request role map feeds
// `CurrentActor`; the CRUD backs the project-members admin routes.

export interface ProjectMemberModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly principalType: ProjectPrincipalType;
  readonly principalId: string;
  readonly role: ProjectRole;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

/** List row enriched with the member's display identity for the UI. */
export interface ProjectMemberDetail extends ProjectMemberModel {
  /** The member's user display name. Null if dangling. */
  readonly displayName: string | null;
  readonly email: string | null;
}

export interface ProjectMemberRepository {
  /** projectId → role for one principal — resolved once per request. */
  readonly rolesForPrincipal: (params: {
    readonly organizationId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
  }) => Effect.Effect<Readonly<Record<string, ProjectRole>>>;

  readonly listByProject: (params: {
    readonly organizationId: string;
    readonly projectId: string;
  }) => Effect.Effect<readonly ProjectMemberDetail[]>;

  /** Insert-or-update the principal's role on a project (idempotent). */
  readonly upsert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
    readonly role: ProjectRole;
    readonly now: string;
  }) => Effect.Effect<void>;

  /** Returns `false` when no row matched (absent membership). */
  readonly remove: (params: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
  }) => Effect.Effect<boolean>;

  /** Drop every membership row of a principal (member removal / robot revoke). */
  readonly removeAllForPrincipal: (params: {
    readonly organizationId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
  }) => Effect.Effect<void>;
}

export class ProjectMemberRepo extends Context.Tag("api/ProjectMemberRepo")<
  ProjectMemberRepo,
  ProjectMemberRepository
>() {}

// -- D1 Adapter --------------------------------------------------------------

const isProjectRole = (value: string): value is ProjectRole =>
  value === "maintainer" || value === "developer" || value === "reporter";

const isPrincipalType = (value: string): value is ProjectPrincipalType => value === "member";

export const ProjectMemberRepoLive = Layer.succeed(ProjectMemberRepo, {
  rolesForPrincipal: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("project_member")
          .select(["project_id", "role"])
          .where("organization_id", "=", params.organizationId)
          .where("principal_type", "=", params.principalType)
          .where("principal_id", "=", params.principalId)
          .execute(),
      );
      return Object.fromEntries(
        rows.flatMap((row) => (isProjectRole(row.role) ? [[row.project_id, row.role]] : [])),
      );
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Resolve display identities in one pass through member→user (robot
      // rows no longer exist — migration 0092 removed them for good).
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("project_member as pm")
          .leftJoin("member as m", (join) =>
            join.onRef("m.id", "=", "pm.principal_id").on("pm.principal_type", "=", "member"),
          )
          .leftJoin("user as u", "u.id", "m.user_id")
          .select([
            "pm.id",
            "pm.organization_id",
            "pm.project_id",
            "pm.principal_type",
            "pm.principal_id",
            "pm.role",
            "pm.created_at",
            "pm.updated_at",
            "u.name as user_name",
            "u.email as user_email",
          ])
          .where("pm.organization_id", "=", params.organizationId)
          .where("pm.project_id", "=", params.projectId)
          .orderBy("pm.created_at", "asc")
          .execute(),
      );
      return rows.flatMap((row) =>
        isProjectRole(row.role) && isPrincipalType(row.principal_type)
          ? [
              {
                id: row.id,
                organizationId: row.organization_id,
                projectId: row.project_id,
                principalType: row.principal_type,
                principalId: row.principal_id,
                role: row.role,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                displayName: row.user_name,
                email: row.user_email,
              },
            ]
          : [],
      );
    }),

  upsert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("project_member")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            project_id: params.projectId,
            principal_type: params.principalType,
            principal_id: params.principalId,
            role: params.role,
            created_at: params.now,
          })
          .onConflict((oc) =>
            oc
              .columns(["project_id", "principal_type", "principal_id"])
              .doUpdateSet({ role: params.role, updated_at: params.now }),
          )
          .execute(),
      );
    }),

  remove: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .deleteFrom("project_member")
          .where("organization_id", "=", params.organizationId)
          .where("project_id", "=", params.projectId)
          .where("principal_type", "=", params.principalType)
          .where("principal_id", "=", params.principalId)
          .executeTakeFirst(),
      );
      return Number(result.numDeletedRows) > 0;
    }),

  removeAllForPrincipal: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("project_member")
          .where("organization_id", "=", params.organizationId)
          .where("principal_type", "=", params.principalType)
          .where("principal_id", "=", params.principalId)
          .execute(),
      );
    }),
});
