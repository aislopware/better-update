import { Context, Effect, Layer } from "effect";

import { maxProjectRole } from "../auth/role-matrix";
import { kyselyDb } from "../cloudflare/db";

import type { ProjectPrincipalType, ProjectRole } from "../models";

// -- Port ------------------------------------------------------------------
// Project membership (docs/specs/authz/GITLAB-RBAC-SPEC.md §1/§4a): one row
// per org member per project, carrying the fixed project role (robots hold
// theirs on `robot_account`, §1b). The per-request role map feeds
// `CurrentActor`; the CRUD backs the project-members admin routes.
//
// Org-wide membership ("all projects", mirroring org_credential_binding): an
// `org_project_member` row grants the role on EVERY project of the org —
// present and future — resolved at query time. Explicit rows still apply;
// the effective role per project is the max of the two.

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
  /** True when an org-wide ("all projects") grant contributes to this row. */
  readonly allProjects: boolean;
}

/** One member's memberships for the org Members screen (names embedded). */
export interface MemberProjectMembershipSummary {
  readonly principalId: string;
  readonly allProjectsRole: ProjectRole | null;
  readonly projects: readonly {
    readonly projectId: string;
    readonly projectName: string;
    readonly role: ProjectRole;
  }[];
}

export interface ProjectMemberRepository {
  /**
   * projectId → EFFECTIVE role for one principal — resolved once per request.
   * An org-wide row expands to every project of the org (max with explicit).
   */
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

  /** Drop every membership row of a principal — explicit AND org-wide. */
  readonly removeAllForPrincipal: (params: {
    readonly organizationId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
  }) => Effect.Effect<void>;

  /** The principal's org-wide ("all projects") role, or null when absent. */
  readonly findAllProjects: (params: {
    readonly organizationId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
  }) => Effect.Effect<ProjectRole | null>;

  /** Insert-or-update the principal's org-wide role (idempotent). */
  readonly upsertAllProjects: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
    readonly role: ProjectRole;
    readonly now: string;
  }) => Effect.Effect<void>;

  /** Returns `false` when no org-wide row existed. */
  readonly removeAllProjects: (params: {
    readonly organizationId: string;
    readonly principalType: ProjectPrincipalType;
    readonly principalId: string;
  }) => Effect.Effect<boolean>;

  /** Per-member membership summaries for the whole org (Members screen). */
  readonly membershipSummariesByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly MemberProjectMembershipSummary[]>;
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
      return yield* Effect.promise(async () => {
        const [rows, orgWide] = await Promise.all([
          db
            .selectFrom("project_member")
            .select(["project_id", "role"])
            .where("organization_id", "=", params.organizationId)
            .where("principal_type", "=", params.principalType)
            .where("principal_id", "=", params.principalId)
            .execute(),
          db
            .selectFrom("org_project_member")
            .select("role")
            .where("organization_id", "=", params.organizationId)
            .where("principal_type", "=", params.principalType)
            .where("principal_id", "=", params.principalId)
            .executeTakeFirst(),
        ]);
        const explicit: Record<string, ProjectRole> = Object.fromEntries(
          rows.flatMap((row) => (isProjectRole(row.role) ? [[row.project_id, row.role]] : [])),
        );
        const allProjectsRole =
          orgWide !== undefined && isProjectRole(orgWide.role) ? orgWide.role : null;
        if (allProjectsRole === null) {
          return explicit;
        }
        // Org-wide expansion (same shape as org_credential_binding): every
        // project of the org gets at least the org-wide role.
        const projects = await db
          .selectFrom("projects")
          .select("id")
          .where("organization_id", "=", params.organizationId)
          .execute();
        return projects.reduce((acc, project) => {
          const explicitRole = acc[project.id];
          return {
            ...acc,
            [project.id]:
              maxProjectRole(explicitRole === undefined ? null : explicitRole, allProjectsRole) ??
              allProjectsRole,
          };
        }, explicit);
      });
    }),

  listByProject: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Resolve display identities in one pass through member→user (robot
      // rows no longer exist — migration 0092 removed them for good).
      const [rows, orgWideRows] = yield* Effect.promise(async () =>
        Promise.all([
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
            .execute(),
          db
            .selectFrom("org_project_member as opm")
            .leftJoin("member as m", (join) =>
              join.onRef("m.id", "=", "opm.principal_id").on("opm.principal_type", "=", "member"),
            )
            .leftJoin("user as u", "u.id", "m.user_id")
            .select([
              "opm.id",
              "opm.organization_id",
              "opm.principal_type",
              "opm.principal_id",
              "opm.role",
              "opm.created_at",
              "opm.updated_at",
              "u.name as user_name",
              "u.email as user_email",
            ])
            .where("opm.organization_id", "=", params.organizationId)
            .execute(),
        ]),
      );
      const explicit = rows.flatMap((row) =>
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
                allProjects: false,
              },
            ]
          : [],
      );
      // An org-wide grant covers this project too: raise the explicit row to
      // the max of the two roles, and synthesize a row (projectId = the
      // queried project) for members with no explicit row here — mirroring
      // project-credential-bindings.listByProject.
      const orgWideRoleByPrincipal = new Map(
        orgWideRows.flatMap((row) =>
          isProjectRole(row.role) && isPrincipalType(row.principal_type)
            ? [[row.principal_id, row.role] as const]
            : [],
        ),
      );
      const merged = explicit.map((detail) => {
        const allProjectsRole = orgWideRoleByPrincipal.get(detail.principalId);
        return allProjectsRole === undefined
          ? detail
          : {
              ...detail,
              role: maxProjectRole(detail.role, allProjectsRole) ?? detail.role,
              allProjects: true,
            };
      });
      const explicitPrincipalIds = new Set(explicit.map((detail) => detail.principalId));
      const synthesized = orgWideRows.flatMap((row) =>
        isProjectRole(row.role) &&
        isPrincipalType(row.principal_type) &&
        !explicitPrincipalIds.has(row.principal_id)
          ? [
              {
                id: row.id,
                organizationId: row.organization_id,
                projectId: params.projectId,
                principalType: row.principal_type,
                principalId: row.principal_id,
                role: row.role,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                displayName: row.user_name,
                email: row.user_email,
                allProjects: true,
              },
            ]
          : [],
      );
      return [...merged, ...synthesized].toSorted((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
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
        Promise.all([
          db
            .deleteFrom("project_member")
            .where("organization_id", "=", params.organizationId)
            .where("principal_type", "=", params.principalType)
            .where("principal_id", "=", params.principalId)
            .execute(),
          db
            .deleteFrom("org_project_member")
            .where("organization_id", "=", params.organizationId)
            .where("principal_type", "=", params.principalType)
            .where("principal_id", "=", params.principalId)
            .execute(),
        ]),
      );
    }),

  findAllProjects: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("org_project_member")
          .select("role")
          .where("organization_id", "=", params.organizationId)
          .where("principal_type", "=", params.principalType)
          .where("principal_id", "=", params.principalId)
          .executeTakeFirst(),
      );
      return row !== undefined && isProjectRole(row.role) ? row.role : null;
    }),

  upsertAllProjects: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("org_project_member")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            principal_type: params.principalType,
            principal_id: params.principalId,
            role: params.role,
            created_at: params.now,
          })
          .onConflict((oc) =>
            oc
              .columns(["organization_id", "principal_type", "principal_id"])
              .doUpdateSet({ role: params.role, updated_at: params.now }),
          )
          .execute(),
      );
    }),

  removeAllProjects: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .deleteFrom("org_project_member")
          .where("organization_id", "=", params.organizationId)
          .where("principal_type", "=", params.principalType)
          .where("principal_id", "=", params.principalId)
          .executeTakeFirst(),
      );
      return Number(result.numDeletedRows) > 0;
    }),

  membershipSummariesByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const [explicit, orgWide] = yield* Effect.promise(async () =>
        Promise.all([
          db
            .selectFrom("project_member as pm")
            .innerJoin("projects as p", "p.id", "pm.project_id")
            .select(["pm.principal_id", "pm.project_id", "pm.role", "p.name as project_name"])
            .where("pm.organization_id", "=", params.organizationId)
            .where("pm.principal_type", "=", "member")
            .orderBy("p.name", "asc")
            .execute(),
          db
            .selectFrom("org_project_member")
            .select(["principal_id", "role"])
            .where("organization_id", "=", params.organizationId)
            .where("principal_type", "=", "member")
            .execute(),
        ]),
      );
      const allProjectsByPrincipal = new Map(
        orgWide.flatMap((row) =>
          isProjectRole(row.role) ? [[row.principal_id, row.role] as const] : [],
        ),
      );
      const projectsByPrincipal = explicit.reduce<
        Readonly<Record<string, MemberProjectMembershipSummary["projects"]>>
      >(
        (acc, row) =>
          isProjectRole(row.role)
            ? {
                ...acc,
                [row.principal_id]: [
                  ...(acc[row.principal_id] ?? []),
                  { projectId: row.project_id, projectName: row.project_name, role: row.role },
                ],
              }
            : acc,
        {},
      );
      const principalIds = [
        ...new Set([...Object.keys(projectsByPrincipal), ...allProjectsByPrincipal.keys()]),
      ];
      return principalIds.map((principalId) => {
        const allProjectsRole = allProjectsByPrincipal.get(principalId);
        return {
          principalId,
          allProjectsRole: allProjectsRole === undefined ? null : allProjectsRole,
          projects: projectsByPrincipal[principalId] ?? [],
        };
      });
    }),
});
