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
  /** Authentication source — "session" for browser + CLI sessions, "robot" for robot-account (CI) bearer tokens. */
  source: Schema.Literal("session", "robot"),
  /** Email or descriptor identifying the actor — useful when `user` is null (robot-account auth). */
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
  /** Holds `policy:update` on `org` — gates the Access sheet's mutations. */
  canManagePolicies: Schema.Boolean,
  /** Holds `policy:read` on `org` — gates the Access column + policies/groups pages. */
  canViewPolicies: Schema.Boolean,
  /** Holds `auditLog:read` on `org` — gates the Audit log page. */
  canViewAuditLog: Schema.Boolean,
  /** Holds `appleCredential:read` on `org` — gates the Credentials pages. */
  canViewCredentials: Schema.Boolean,
  /** Holds `device:read` on `org` — gates the Devices page. */
  canViewDevices: Schema.Boolean,
  /** Holds `vaultAccess:read` on `org` — gates the Vault access page. */
  canViewVaultAccess: Schema.Boolean,
  /** Holds `robotAccount:read` on `org` — gates the Robot accounts page. */
  canViewRobots: Schema.Boolean,
  /** Holds `envVar:read` over the `project/global` subtree — gates the Org env vars page. */
  canManageOrgEnvVars: Schema.Boolean,
  /** Holds `organization:update` on `org` — gates Organization settings mutations. */
  canManageOrgSettings: Schema.Boolean,
});
