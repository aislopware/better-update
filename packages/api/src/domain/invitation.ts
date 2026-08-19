import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

// A pending organization invitation, as surfaced by the IAM-gated
// create/list/cancel endpoints. These rows live in the same `invitation` table
// the better-auth `organization` plugin reads from `accept-invitation`, so the
// shape here mirrors the columns that flow into that handler (`status`,
// `expiresAt`, `role`, `email`).
export const Invitation = Schema.Struct({
  id: Id,
  email: Schema.String,
  // Stored verbatim; "member" or "admin" under the GitLab-RBAC model. The
  // underlying column is nullable, so legacy rows may surface a null role.
  role: Schema.NullOr(Schema.String),
  status: Schema.String,
  expiresAt: DateTimeString,
  createdAt: DateTimeString,
}).annotate({ identifier: "Invitation" });
export type Invitation = typeof Invitation.Type;

// A pragmatic email shape check, mirroring better-auth's own `z.email()` guard on
// its invite path so the IAM endpoint rejects malformed addresses (which could
// never be accepted) instead of persisting junk pending rows.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// Org roles invitable via the IAM endpoint (GITLAB-RBAC-SPEC §2): "member" by
// default; "admin" requires the inviter to be an owner (handler guard —
// granting admin is owner-only). "owner" is never invitable: it is the
// undeniable root, set at org creation only.
const InvitableOrgRole = Schema.Literals(["member", "admin"]);

export const ProjectRoleLiteral = Schema.Literals(["maintainer", "developer", "reporter"]);

/** A project grant carried by an invitation, materialized as a `project_member` row on accept. */
export const InvitationProjectGrant = Schema.Struct({
  projectId: Id,
  role: ProjectRoleLiteral,
});

export const CreateInvitationBody = Schema.Struct({
  email: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(320),
    Schema.isPattern(EMAIL_PATTERN),
  ),
  // Optional; defaults to "member" when omitted.
  role: Schema.optional(InvitableOrgRole),
  /**
   * Project memberships granted when the invitation is accepted
   * (GITLAB-RBAC-SPEC §4c). Validated against the INVITER at create time: an
   * org admin/owner may grant any role on any project; a project maintainer
   * may grant roles up to maintainer on THEIR projects only.
   */
  projects: Schema.optional(Schema.Array(InvitationProjectGrant).check(Schema.isMaxLength(100))),
  /**
   * Org-wide ("all projects") membership granted when the invitation is
   * accepted — every project, present and future, materialized as an
   * `org_project_member` row (the invitation analog of the members
   * set-all-projects endpoint). Org administration, so the inviter must hold
   * `member:update` (org admin/owner) — a project maintainer cannot grant it.
   */
  allProjectsRole: Schema.optional(ProjectRoleLiteral),
});

export const InvitationList = Schema.Struct({ items: Schema.Array(Invitation) });
