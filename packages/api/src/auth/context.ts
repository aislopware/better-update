import { Context } from "effect";

// Built-in role names stay nominal for the static map; custom roles are arbitrary
// lowercased strings. The widened alias keeps member.role assignable to any string
// while preserving literal autocompletion for the built-in names. `Record<never,
// never>` is the `ban-types`-clean equivalent of the `string & {}` idiom.
export type BuiltinRole = "owner" | "admin" | "developer" | "viewer";
export type Role = BuiltinRole | (string & Record<never, never>);

export type Resource =
  | "organization"
  | "member"
  | "invitation"
  | "project"
  | "channel"
  | "branch"
  | "update"
  | "rollout"
  | "billing"
  | "apiKey"
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
  | "vaultAccess"
  // manage IAM policies + groups (org-level)
  | "policy"
  | "group";

export type Action = "read" | "create" | "update" | "delete" | "cancel" | "download";

export type PolicyEffect = "allow" | "deny";

/** A single permission statement inside a policy document (IAM model). */
export interface PolicyStatement {
  readonly effect: PolicyEffect;
  readonly actions: readonly string[];
  readonly resources: readonly string[];
}

export interface AuthContextShape {
  readonly userId: string | null;
  readonly organizationId: string;
  /**
   * The active-org membership row id (`member.id`), or `null` for API-key
   * principals. Resolved once in `auth/middleware.ts`; policy attachments key off
   * it (members) or the api-key id (machine principals).
   */
  readonly memberId: string | null;
  readonly role: Role | null;
  /** `member.role === "owner"` — org root: unconditional allow, undeniable. */
  readonly isOwner: boolean;
  /** Flattened policy statements (direct + group + managed presets), resolved once per request. */
  readonly effectiveStatements: readonly PolicyStatement[];
  readonly source: "session" | "api-key";
  /**
   * Transport that carried the credential: `"bearer"` for the CLI/CI
   * (`Authorization` header — both session tokens and API keys) and `"cookie"`
   * for the browser dashboard. Lets us tell a machine/CLI caller apart from a
   * browser session even though both can be `source: "session"`.
   */
  readonly transport: "bearer" | "cookie";
  readonly actorEmail: string;
  /**
   * Global (cross-org) superadmin flag, derived from the Better Auth `admin`
   * plugin's user `role`. Distinct from `role` above, which is the per-org
   * membership role. Gates the platform admin surface (`/api/admin/*`).
   */
  readonly isSuperadmin: boolean;
}

export class AuthContext extends Context.Tag("api/AuthContext")<AuthContext, AuthContextShape>() {}
