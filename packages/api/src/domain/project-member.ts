import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

// Project membership (GITLAB-RBAC-SPEC §1/§4c): one row per org member per
// project, carrying the fixed project role. Org owner/admin never hold rows —
// they are implicit maintainers everywhere. Robots are NOT project members:
// a robot's single project role lives on its `robot_account` row (§1b), so
// the only principal kind here is "member" (the literal stays on the wire
// for forward compatibility).

export const ProjectMemberRole = Schema.Literal("maintainer", "developer", "reporter");
export const ProjectMemberPrincipalType = Schema.Literal("member");

export class ProjectMember extends Schema.Class<ProjectMember>("ProjectMember")({
  id: Id,
  projectId: Id,
  principalType: ProjectMemberPrincipalType,
  /** The org `member.id`. */
  principalId: Id,
  role: ProjectMemberRole,
  /** The member's user display name. Null if dangling. */
  displayName: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: Schema.NullOr(DateTimeString),
}) {}

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
