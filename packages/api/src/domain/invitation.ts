import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

// A pending organization invitation, as surfaced by the IAM-gated
// create/list/cancel endpoints. These rows live in the same `invitation` table
// the better-auth `organization` plugin reads from `accept-invitation`, so the
// shape here mirrors the columns that flow into that handler (`status`,
// `expiresAt`, `role`, `email`).
export class Invitation extends Schema.Class<Invitation>("Invitation")({
  id: Id,
  email: Schema.String,
  // Stored verbatim; "member" or "admin" under the GitLab-RBAC model. The
  // underlying column is nullable, so legacy rows may surface a null role.
  role: Schema.NullOr(Schema.String),
  status: Schema.String,
  expiresAt: DateTimeString,
  createdAt: DateTimeString,
}) {}

// A pragmatic email shape check, mirroring better-auth's own `z.email()` guard on
// its invite path so the IAM endpoint rejects malformed addresses (which could
// never be accepted) instead of persisting junk pending rows.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

// Org roles invitable via the IAM endpoint (GITLAB-RBAC-SPEC §2): "member" by
// default; "admin" requires the inviter to be an owner (handler guard —
// granting admin is owner-only). "owner" is never invitable: it is the
// undeniable root, set at org creation only.
const InvitableOrgRole = Schema.Literal("member", "admin");

export const ProjectRoleLiteral = Schema.Literal("maintainer", "developer", "reporter");

/** A project grant carried by an invitation, materialized as a `project_member` row on accept. */
export const InvitationProjectGrant = Schema.Struct({
  projectId: Id,
  role: ProjectRoleLiteral,
});

export const CreateInvitationBody = Schema.Struct({
  email: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(320),
    Schema.pattern(EMAIL_PATTERN),
  ),
  // Optional; defaults to "member" when omitted.
  role: Schema.optional(InvitableOrgRole),
  /**
   * Project memberships granted when the invitation is accepted
   * (GITLAB-RBAC-SPEC §4c). Validated against the INVITER at create time: an
   * org admin/owner may grant any role on any project; a project maintainer
   * may grant roles up to maintainer on THEIR projects only.
   */
  projects: Schema.optional(Schema.Array(InvitationProjectGrant).pipe(Schema.maxItems(100))),
});

export const InvitationList = Schema.Struct({ items: Schema.Array(Invitation) });
