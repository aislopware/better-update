// Authorization model types (RBAC roles/permissions + per-scope ABAC grants +
// dynamic-AC custom roles). Kept out of ./models to stay under the max-lines
// budget, mirroring ./env-var-models and ./submission-models. The shared
// permission scalars below are re-exported from ./models for existing consumers.

// Built-ins are nominal for the static permission map; custom (dynamic-AC) roles
// are arbitrary strings. `Record<never, never>` is the `ban-types`-clean
// `string & {}` (keeps built-in autocompletion while accepting any string).
export type BuiltinRole = "owner" | "admin" | "developer" | "viewer";
export type Role = BuiltinRole | (string & Record<never, never>);

export type Resource =
  | "organization"
  | "member"
  | "invitation"
  // manage custom roles (better-auth dynamic-AC meta-resource)
  | "ac"
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
  | "vaultAccess";

export type Action = "read" | "create" | "update" | "delete" | "cancel" | "download";

export type EffectivePermissions = Partial<Record<Resource, readonly Action[]>>;

export type ScopeKind = "channel" | "env_var_environment";

export type GrantEffect = "allow" | "deny";

export interface EnvironmentGrantModel {
  readonly id: string;
  readonly organizationId: string;
  readonly memberId: string;
  readonly scopeKind: ScopeKind;
  readonly scopeId: string;
  readonly effect: GrantEffect;
  /** Decoded JSON array of "resource:action" strings. */
  readonly actions: readonly string[];
  readonly createdAt: string;
}
