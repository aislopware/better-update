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
  // Stored verbatim; defaults to "member" in the unified IAM model (admin /
  // developer / viewer come from policy attachments, not the invite role). The
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

// Roles invitable via the IAM endpoint: member-ONLY in the unified IAM model.
// "admin" is no longer invitable — admin-ness (and developer/viewer) is conferred
// EXCLUSIVELY by policy attachments after the member joins, not by the invite
// role. "owner" is likewise excluded: it is the undeniable root bypass
// (member.role === "owner"), set only at org creation and never grantable by
// invite — otherwise a holder of `invitation:create` (without being owner) could
// escalate an accomplice to org root.
const InvitableRole = Schema.Literal("member");

export const CreateInvitationBody = Schema.Struct({
  email: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(320),
    Schema.pattern(EMAIL_PATTERN),
  ),
  // Optional; defaults to "member" when omitted (the unified-model baseline).
  role: Schema.optional(InvitableRole),
  /**
   * Access grants applied when the invitation is accepted
   * (ROLES-CAPABILITIES-SPEC §8d). Policy ids in the attachment grammar:
   * `managed:{maintainer|developer|viewer}@{projectId|*}`, `managed:cap-*`,
   * `managed:admin`, or a real policy id. Validated + permission-boundary
   * checked against the INVITER at create time.
   */
  grants: Schema.optional(Schema.Array(Schema.String.pipe(Schema.maxLength(256)))),
});

export const InvitationList = Schema.Struct({ items: Schema.Array(Invitation) });
