import { Schema } from "effect";

export const MeUser = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

export const MeOrganization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  role: Schema.NullOr(Schema.String),
});

export const Me = Schema.Struct({
  user: Schema.NullOr(MeUser),
  activeOrganization: Schema.NullOr(MeOrganization),
  /** Authentication source — "session" for browser + CLI sessions, "api-key" for API-key (CI) bearer tokens. */
  source: Schema.Literal("session", "api-key"),
  /** Email or descriptor identifying the actor — useful when `user` is null (api-key auth). */
  actorEmail: Schema.String,
  // Per-action member-management capabilities for the active org, each mirroring
  // the EXACT token its endpoint gates on so the UI never shows an action the
  // server would 403. Owner/superadmin are roots (true everywhere). Membership
  // role is `owner | member`; admin/developer/viewer powers come from policy
  // attachments, not the role string.
  /** Holds `invitation:create` on `org` — gates the Invite button. */
  canInviteMembers: Schema.Boolean,
  /** Holds `member:delete` on `org` — gates the per-member Remove action. */
  canRemoveMembers: Schema.Boolean,
  /** Holds `policy:update` on `org` — gates the per-member Manage-policies action. */
  canManagePolicies: Schema.Boolean,
});
