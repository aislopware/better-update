// Authorization model types — IAM Policy + Group model. Kept out of ./models to
// stay under the max-lines budget, mirroring ./env-var-models and
// ./submission-models. The shared permission scalars below are re-exported from
// ./models for existing consumers.
//
// Design: docs/specs/authz/POLICY-GROUPS-SPEC.md. Access is granted by POLICIES
// (named JSON documents of allow/deny statements) attached — directly or via
// GROUPS — to a principal (member / group / robot account), evaluated against
// an object-scoped, path-glob selector with deny-wins, default-deny resolution.

// Built-in preset names back the managed (code-defined) policies; `member.role`
// is still an arbitrary string but the app only distinguishes "owner" (root
// bypass) from everything else. `Record<never, never>` is the `ban-types`-clean
// `string & {}` (keeps built-in autocompletion while accepting any string).
export type BuiltinRole = "owner" | "admin" | "developer" | "viewer";
export type Role = BuiltinRole | (string & Record<never, never>);

export type Resource =
  | "organization"
  | "member"
  | "invitation"
  // manage IAM policies + groups (org-level)
  | "policy"
  | "group"
  | "project"
  | "channel"
  | "branch"
  | "environment"
  | "update"
  | "rollout"
  | "billing"
  | "robotAccount"
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

// -- Policy documents -------------------------------------------------------

export type PolicyEffect = "allow" | "deny";

/** A single permission statement inside a policy document. */
export interface PolicyStatement {
  readonly effect: PolicyEffect;
  /** Action tokens: "resource:action" | "resource:*" | "*". */
  readonly actions: readonly string[];
  /** Path-glob selectors: "*", "project/A", "project/*\/env/production", … */
  readonly resources: readonly string[];
}

export interface PolicyDocument {
  readonly statements: readonly PolicyStatement[];
}

export interface PolicyModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly document: PolicyDocument;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export interface GroupModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string | null;
}

export type PrincipalType = "member" | "group" | "robot";

export type AuditLogSource = "session" | "robot";

/** The authenticated actor a handler sees (via `CurrentActor` in auth/current-actor). */
export interface CurrentActor {
  readonly userId: string | null;
  readonly organizationId: string;
  // Active-org `member.id`, or `null` for robot principals (no membership row).
  readonly memberId: string | null;
  readonly role: Role | null;
  /** `member.role === "owner"` — org root: unconditional allow, undeniable. */
  readonly isOwner: boolean;
  /** Flattened policy statements (direct + group + managed presets), resolved once per request. */
  readonly effectiveStatements: readonly PolicyStatement[];
  readonly source: AuditLogSource;
  readonly transport: "bearer" | "cookie";
  readonly sessionId: string | null;
  readonly actorEmail: string;
  readonly isSuperadmin: boolean;
  /** `robot_account.id` for robot-bearer requests, `null` for user sessions. */
  readonly robotId: string | null;
}

export interface PolicyAttachmentModel {
  readonly id: string;
  readonly organizationId: string;
  /** A real `policy.id` OR a virtual managed preset id ("managed:admin"). */
  readonly policyId: string;
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly createdAt: string;
}

// -- Object references ------------------------------------------------------

/**
 * Structured target for `assertAccess`, resolved to a canonical path string by
 * `resolvePath` (auth/policy-match.ts). Parent ids are supplied by the call site.
 *
 * Two independent subtrees hang under a project (SPEC §2):
 *   - the CHANNEL axis (OTA): channel → update / rollout. Scoped by channel id;
 *     no env segment (channels↔branches are a separate axis from env-var envs).
 *   - the ENV-VAR axis: env (the development/preview/production enum) → envVar.
 *     `projectId` is "global" for org-wide vars.
 * Plus per-project build / submission leaves. The "credential" leaf is RESERVED
 * for future per-project credential scoping: credential handlers currently gate at
 * org scope via `assertPermission`, so this variant is defined + unit-tested but is
 * not yet an enforcement target (a `project/.../credential/...` selector has no
 * effect until those handlers adopt it).
 */
export type ObjectRef =
  | { readonly kind: "org" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "build"; readonly projectId: string; readonly buildId?: string }
  | { readonly kind: "credential"; readonly projectId: string; readonly credentialId?: string }
  | { readonly kind: "submission"; readonly projectId: string; readonly submissionId?: string }
  | { readonly kind: "environment"; readonly projectId: string; readonly environment: string }
  | {
      readonly kind: "envVar";
      readonly projectId: string;
      readonly environment: string;
      readonly key?: string;
    }
  | { readonly kind: "channel"; readonly projectId: string; readonly channelId: string }
  | {
      readonly kind: "update";
      readonly projectId: string;
      readonly channelId: string;
      readonly updateId?: string;
    }
  | {
      readonly kind: "rollout";
      readonly projectId: string;
      readonly channelId: string;
      readonly rolloutId?: string;
    };
