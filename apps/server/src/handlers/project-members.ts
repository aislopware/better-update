import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import type { ProjectMember } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { effectiveProjectRole, projectRoleAtLeast } from "../auth/role-matrix";
import { Forbidden, NotFound } from "../errors";
import { toApiCrudEffect } from "../http/to-api-effect";
import { MemberRepo } from "../repositories/member-repo";
import { ProjectMemberRepo } from "../repositories/project-members";
import { ProjectRepo } from "../repositories/projects";
import { reconcileVaultAccess } from "./reconcile-vault-access";

import type { ProjectPrincipalType, ProjectRole } from "../models";
import type { ProjectMemberDetail } from "../repositories/project-members";

const toApiProjectMember = (detail: ProjectMemberDetail): ProjectMember => ({
  id: detail.id,
  projectId: detail.projectId,
  principalType: detail.principalType,
  principalId: detail.principalId,
  role: detail.role,
  allProjects: detail.allProjects,
  displayName: detail.displayName,
  email: detail.email,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
});

// Load the project org-scoped (404 on cross-org, mirroring every by-id
// handler) — the shared preamble of all four routes.
const loadProject = (projectId: string) =>
  Effect.gen(function* () {
    const repo = yield* ProjectRepo;
    const project = yield* repo.findById({ id: projectId });
    yield* assertOrgOwnership(project.organizationId);
    return project;
  });

// Membership mutations require Maintainer+ on the project (GITLAB-RBAC-SPEC
// §2: project_member add/update/remove ≤ maintainer). Org owner/admin and
// superadmin are implicit maintainers.
const assertProjectMaintainer = (projectId: string) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    if (!projectRoleAtLeast(effectiveProjectRole(ctx, projectId), "maintainer")) {
      return yield* new Forbidden({
        message: "Managing project members requires the Maintainer role on this project",
      });
    }
  });

// The member must exist in THIS org before it can hold a membership row —
// a dangling or cross-org id is NotFound, never a silent grant. Robots are
// not project members (their role lives on `robot_account`, spec §1b); the
// API schema only admits `principalType: "member"`.
const assertPrincipalInOrg = (params: { readonly principalId: string }) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const memberRepo = yield* MemberRepo;
    const member = yield* memberRepo.findInOrg({
      id: params.principalId,
      organizationId: ctx.organizationId,
    });
    if (member === null) {
      return yield* new NotFound({ message: "Member not found in this organization" });
    }
  });

const findDetail = (params: {
  readonly organizationId: string;
  readonly projectId: string;
  readonly principalId: string;
}) =>
  Effect.gen(function* () {
    const repo = yield* ProjectMemberRepo;
    const rows = yield* repo.listByProject({
      organizationId: params.organizationId,
      projectId: params.projectId,
    });
    const row = rows.find((candidate) => candidate.principalId === params.principalId);
    if (row === undefined) {
      return yield* new NotFound({ message: "Project member not found" });
    }
    return row;
  });

const upsertRole = (params: {
  readonly projectId: string;
  readonly principalType: ProjectPrincipalType;
  readonly principalId: string;
  readonly role: ProjectRole;
  readonly action: "projectMember.add" | "projectMember.role_update";
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const repo = yield* ProjectMemberRepo;
    yield* repo.upsert({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      projectId: params.projectId,
      principalType: params.principalType,
      principalId: params.principalId,
      role: params.role,
      now: new Date().toISOString(),
    });
    yield* logAudit({
      action: params.action,
      resourceType: "member",
      resourceId: params.principalId,
      projectId: params.projectId,
      metadata: {
        projectId: params.projectId,
        principalType: params.principalType,
        role: params.role,
      },
    });
    return yield* findDetail({
      organizationId: ctx.organizationId,
      projectId: params.projectId,
      principalId: params.principalId,
    });
  });

export const ProjectMembersGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "project-members",
  (handlers) =>
    handlers
      .handle("list", ({ params }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* loadProject(params.id);
            yield* assertAccess("project", "read", { kind: "project", projectId: params.id });
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectMemberRepo;
            const rows = yield* repo.listByProject({
              organizationId: ctx.organizationId,
              projectId: params.id,
            });
            return { items: rows.map(toApiProjectMember) };
          }),
        ),
      )
      .handle("add", ({ params, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* loadProject(params.id);
            yield* assertProjectMaintainer(params.id);
            yield* assertPrincipalInOrg(payload);
            const detail = yield* upsertRole({
              projectId: params.id,
              principalType: payload.principalType,
              principalId: payload.principalId,
              role: payload.role,
              action: "projectMember.add",
            });
            return toApiProjectMember(detail);
          }),
        ),
      )
      .handle("updateRole", ({ params, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* loadProject(params.id);
            yield* assertProjectMaintainer(params.id);
            const ctx = yield* CurrentActor;
            // Must already be a member — PATCH never silently grants.
            yield* findDetail({
              organizationId: ctx.organizationId,
              projectId: params.id,
              principalId: params.principalId,
            });
            const detail = yield* upsertRole({
              projectId: params.id,
              principalType: payload.principalType,
              principalId: params.principalId,
              role: payload.role,
              action: "projectMember.role_update",
            });
            // Vault participation = ≥ developer on SOME project, so a downgrade
            // to reporter can strip it — reconcile the recipient set (no-op when
            // the member still qualifies elsewhere; never fails the mutation).
            if (payload.role === "reporter") {
              yield* reconcileVaultAccess({
                organizationId: ctx.organizationId,
                reason: `project-member-role-change:${params.principalId}`,
              });
            }
            return toApiProjectMember(detail);
          }),
        ),
      )
      .handle("remove", ({ params, query }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* loadProject(params.id);
            yield* assertProjectMaintainer(params.id);
            const ctx = yield* CurrentActor;
            const repo = yield* ProjectMemberRepo;
            const removed = yield* repo.remove({
              organizationId: ctx.organizationId,
              projectId: params.id,
              principalType: query.principalType,
              principalId: params.principalId,
            });
            if (!removed) {
              return yield* new NotFound({ message: "Project member not found" });
            }
            yield* logAudit({
              action: "projectMember.remove",
              resourceType: "member",
              resourceId: params.principalId,
              projectId: params.id,
              metadata: { projectId: params.id, principalType: query.principalType },
            });
            // Losing a membership row can strip vault participation (≥ developer
            // on SOME project) — reconcile the recipient set.
            yield* reconcileVaultAccess({
              organizationId: ctx.organizationId,
              reason: `project-member-remove:${params.principalId}`,
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
