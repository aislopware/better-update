import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

// Project membership (GITLAB-RBAC-SPEC §1/§4c): one row per org member per
// project, carrying the fixed project role. Org owner/admin never hold rows —
// they are implicit maintainers everywhere. Robots are NOT project members:
// a robot's single project role lives on its `robot_account` row (§1b), so
// the only principal kind here is "member" (the literal stays on the wire
// for forward compatibility).

export const ProjectMemberRole = Schema.Literals(["maintainer", "developer", "reporter"]);
export const ProjectMemberPrincipalType = Schema.Literal("member");

export const ProjectMember = Schema.Struct({
  id: Id,
  projectId: Id,
  principalType: ProjectMemberPrincipalType,
  /** The org `member.id`. */
  principalId: Id,
  /**
   * Effective role on the project: the higher of the explicit row and the
   * member's org-wide ("all projects") role, when both exist.
   */
  role: ProjectMemberRole,
  /**
   * True when the membership comes (at least in part) from an org-wide
   * "all projects" grant — managed on the org Members screen, not here.
   */
  allProjects: Schema.Boolean,
  /** The member's user display name. Null if dangling. */
  displayName: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: Schema.NullOr(DateTimeString),
}).annotate({ identifier: "ProjectMember" });
export type ProjectMember = typeof ProjectMember.Type;

export const ProjectMemberList = Schema.Struct({ items: Schema.Array(ProjectMember) });

/** Add-or-update a principal's role on the project (idempotent upsert). */
export const UpsertProjectMemberBody = Schema.Struct({
  principalType: ProjectMemberPrincipalType,
  principalId: Id,
  role: ProjectMemberRole,
});

export const UpdateProjectMemberBody = Schema.Struct({
  principalType: ProjectMemberPrincipalType,
  role: ProjectMemberRole,
});

/** DELETE carries the principal type as a query param (no body on DELETE). */
export const RemoveProjectMemberParams = Schema.Struct({
  principalType: ProjectMemberPrincipalType,
});

// -- Org-wide membership summaries (Members screen) ---------------------------
// Centralized view of every member's project memberships, mirroring the
// org-credential-binding "all projects" model: an org-wide row grants a role
// on every project (present and future); explicit rows still apply and the
// effective role per project is the max of the two.

/** One explicit project membership of an org member, name embedded for the UI. */
export const MemberProjectMembership = Schema.Struct({
  projectId: Id,
  projectName: Schema.String,
  role: ProjectMemberRole,
}).annotate({ identifier: "MemberProjectMembership" });
export type MemberProjectMembership = typeof MemberProjectMembership.Type;

/** Per-member membership summary keyed by the org `member.id`. */
export const MemberProjectMemberships = Schema.Struct({
  principalId: Id,
  /** The org-wide ("all projects") role, or null when no org-wide grant exists. */
  allProjectsRole: Schema.NullOr(ProjectMemberRole),
  projects: Schema.Array(MemberProjectMembership),
}).annotate({ identifier: "MemberProjectMemberships" });
export type MemberProjectMemberships = typeof MemberProjectMemberships.Type;

export const MemberProjectMembershipsList = Schema.Struct({
  items: Schema.Array(MemberProjectMemberships),
});

/** Grant-or-update the member's org-wide role (idempotent upsert). */
export const SetAllProjectsMembershipBody = Schema.Struct({ role: ProjectMemberRole });

export const AllProjectsMembership = Schema.Struct({
  principalId: Id,
  role: ProjectMemberRole,
});
