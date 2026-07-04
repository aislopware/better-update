import { Context } from "effect";

// GitLab-style RBAC scalars (docs/specs/authz/GITLAB-RBAC-SPEC.md §1). Two
// fixed ladders — no custom roles, no policy documents. `member.role` stays a
// free string in better-auth's table; the app reads exactly these three org
// values (anything else degrades to "member").
export type OrgRole = "owner" | "admin" | "member";
export type ProjectRole = "maintainer" | "developer" | "reporter";

// Legacy alias: better-auth APIs surface `member.role` as an arbitrary string.
export type Role = OrgRole | (string & Record<never, never>);

export type Resource =
  | "organization"
  | "member"
  | "invitation"
  | "project"
  | "channel"
  | "branch"
  | "environment"
  | "update"
  | "rollout"
  | "billing"
  | "robotAccount"
  | "credentialBinding"
  | "build"
  | "appleCredential"
  | "androidCredential"
  | "iosBundleConfiguration"
  | "envVar"
  | "auditLog"
  | "device"
  | "webhook"
  | "iosAppMetadata"
  | "submission"
  | "vaultAccess";

export type Action = "read" | "create" | "update" | "delete" | "cancel" | "download";

export interface AuthContextShape {
  readonly userId: string | null;
  readonly organizationId: string;
  /**
   * The active-org membership row id (`member.id`), or `null` for robot-account
   * principals. Project-member rows key off it (members) or the robot account
   * id (machine principals).
   */
  readonly memberId: string | null;
  /** Raw better-auth `member.role` string (owner transfer/UI display only). */
  readonly role: Role | null;
  /**
   * The org ladder position (spec §1): owner = root bypass, admin = org
   * management + implicit maintainer everywhere, member = only what
   * `projectRoles` grants. Robots are always "member" — their single grant
   * is the (projectId → role) entry from the robot row (spec §1b, v2).
   */
  readonly orgRole: OrgRole;
  /** `orgRole === "owner"` — org root: unconditional allow, undeniable. */
  readonly isOwner: boolean;
  /**
   * The principal's `project_member` rows (projectId → role), resolved once
   * per request. Empty for owner/admin — they are implicit maintainers on
   * every project (evaluated in `role-matrix.ts`, never materialized).
   */
  readonly projectRoles: Readonly<Record<string, ProjectRole>>;
  readonly source: "session" | "robot";
  /**
   * Transport that carried the credential: `"bearer"` for the CLI/CI
   * (`Authorization` header — both session tokens and robot bearer secrets) and
   * `"cookie"` for the browser dashboard. Lets us tell a machine/CLI caller apart
   * from a browser session even though both can be `source: "session"`.
   */
  readonly transport: "bearer" | "cookie";
  /**
   * The better-auth `session.id` for a real user session, or `null` for a
   * robot-account principal (no session). Used to scope a WebAuthn step-up to
   * the exact browser session that proved it (see the web-vault step-up gate),
   * so a step-up in one session does not silently authorize another.
   */
  readonly sessionId: string | null;
  readonly actorEmail: string;
  /**
   * Global (cross-org) superadmin flag, derived from the Better Auth `admin`
   * plugin's user `role`. Distinct from the per-org role above. Gates the
   * platform admin surface (`/api/admin/*`).
   */
  readonly isSuperadmin: boolean;
  /**
   * The `robot_account.id` when the request authenticated with a robot bearer
   * secret, `null` for user sessions. Feeds audit-log attribution (`actor_id`)
   * so multiple robots in one org stay distinguishable in the trail.
   */
  readonly robotId: string | null;
}

export class AuthContext extends Context.Tag("api/AuthContext")<AuthContext, AuthContextShape>() {}
