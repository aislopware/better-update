import { Schema } from "effect";

import { DateTimeString, UploadHeaders } from "./common";

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

const OrgRoleLiteral = Schema.Literal("owner", "admin", "member");
const ProjectRoleLiteral = Schema.Literal("maintainer", "developer", "reporter");

export const Me = Schema.Struct({
  user: Schema.NullOr(MeUser),
  activeOrganization: Schema.NullOr(MeOrganization),
  /** Authentication source — "session" for browser + CLI sessions, "robot" for robot-account (CI) bearer tokens. */
  source: Schema.Literal("session", "robot"),
  /** Email or descriptor identifying the actor — useful when `user` is null (robot-account auth). */
  actorEmail: Schema.String,
  /** Org ladder position (GITLAB-RBAC-SPEC §1). Superadmins surface their real per-org role. */
  orgRole: OrgRoleLiteral,
  /**
   * The principal's project_member rows (projectId → role). Empty for
   * owner/admin — they are implicit maintainers everywhere; the UI should key
   * per-project affordances off `orgRole` first, then this map.
   */
  projectRoles: Schema.Record({ key: Schema.String, value: ProjectRoleLiteral }),
  // Sidebar/chrome capability booleans, each recomputed from the role matrix
  // exactly as its endpoint gates, so the UI never shows an action the server
  // would 403. Owner/superadmin are roots (true everywhere).
  /** invitation:create — gates the Invite button. */
  canInviteMembers: Schema.Boolean,
  /** member:delete — gates the per-member Remove action. */
  canRemoveMembers: Schema.Boolean,
  /** member:update — gates the org-role select in the Members table. */
  canManageMembers: Schema.Boolean,
  /** auditLog:read — gates the Audit log page. */
  canViewAuditLog: Schema.Boolean,
  /** appleCredential:read anywhere — gates the Credentials pages. */
  canViewCredentials: Schema.Boolean,
  /** device:read (anywhere-rank) — gates the Devices page. */
  canViewDevices: Schema.Boolean,
  /** vaultAccess:read — gates the Vault access page. */
  canViewVaultAccess: Schema.Boolean,
  /** robotAccount:read — gates the Robot accounts page. */
  canViewRobots: Schema.Boolean,
  /** Org-global env vars surface (read at developer-anywhere). */
  canManageOrgEnvVars: Schema.Boolean,
  /** organization:update — gates Organization settings mutations. */
  canManageOrgSettings: Schema.Boolean,
});

/** Image MIME types accepted for a user avatar. */
export const AvatarContentType = Schema.Literal(
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
);

/**
 * Request a presigned PUT to upload the current user's avatar. The server builds
 * the R2 key itself (`logos/user/{userId}`) — never trusting a client-sent key —
 * and signs the content type into the URL, so the direct upload must send the
 * returned headers.
 */
export const AvatarUploadBody = Schema.Struct({
  contentType: AvatarContentType,
});

export const AvatarUploadResult = Schema.Struct({
  /** R2 object key the presigned URL targets (`logos/user/{userId}`). */
  key: Schema.String,
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});

/** Result of finalizing an avatar upload: the public CDN URL of the stored image. */
export const AvatarResult = Schema.Struct({
  /** Absolute public CDN URL of the avatar; the caller persists it via the auth client. */
  imageUrl: Schema.String,
});
