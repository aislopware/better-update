// Authorization model types — GitLab-style RBAC (docs/specs/authz/
// GITLAB-RBAC-SPEC.md). Kept out of ./models to stay under the max-lines
// budget, mirroring ./env-var-models and ./submission-models. The shared
// permission scalars below are re-exported from ./models for existing
// consumers.
//
// Access is granted by two fixed ladders — an org role (owner | admin |
// member) plus per-project membership rows (maintainer | developer |
// reporter) — evaluated against the static matrix in auth/role-matrix.ts.
// There are no policy documents, no groups, no path globs.

import type { Action, OrgRole, ProjectRole, Resource, Role } from "@better-update/api";

export type { Action, OrgRole, ProjectRole, Resource, Role };

/**
 * Principals that can hold a project membership row. Robots are NOT project
 * members — a robot's single project role lives on its `robot_account` row
 * (spec §1b) — so only org members qualify.
 */
export type ProjectPrincipalType = "member";

/**
 * Resource kinds a `project_credential_binding` row can point at (spec §1a/
 * §3c). `appleTeam` cascades to every child credential and the team's devices;
 * `ascApiKey` is used ONLY for team-less keys; the android kinds are per-row.
 */
export type CredentialBindingType =
  | "appleTeam"
  | "ascApiKey"
  | "googleServiceAccountKey"
  | "androidUploadKeystore";

export type AuditLogSource = "session" | "robot";

/** The authenticated actor a handler sees (via `CurrentActor` in auth/current-actor). */
export interface CurrentActor {
  readonly userId: string | null;
  readonly organizationId: string;
  // Active-org `member.id`, or `null` for robot principals (no membership row).
  readonly memberId: string | null;
  /** Raw better-auth `member.role` string; authz reads `orgRole` instead. */
  readonly role: Role | null;
  /** Org ladder position (spec §1); robots carry `robot_account.org_role`. */
  readonly orgRole: OrgRole;
  /** `orgRole === "owner"` — org root: unconditional allow, undeniable. */
  readonly isOwner: boolean;
  /** `project_member` rows (projectId → role), resolved once per request. */
  readonly projectRoles: Readonly<Record<string, ProjectRole>>;
  readonly source: AuditLogSource;
  readonly transport: "bearer" | "cookie";
  readonly sessionId: string | null;
  readonly actorEmail: string;
  readonly isSuperadmin: boolean;
  /** `robot_account.id` for robot-bearer requests, `null` for user sessions. */
  readonly robotId: string | null;
}

// -- Object references ------------------------------------------------------

/**
 * Structured target for `assertAccess`, resolved to a canonical path string by
 * `resolvePath` (auth/policy.ts) for error messages/audit. Parent ids are
 * supplied by the call site. What matters to the matrix is the `projectId`
 * (project ladder) and, for kinds that carry an `environment`, the
 * protected-environment guard (the channel/branch NAME — arbitrary:
 * "production", "preview", "feature-x").
 *
 * A separate APPLE-TEAM axis scopes Apple credentials by the 10-char Apple
 * Team identifier (`appleTeam/{T}/credential[/{id}]`). Every credential type
 * under the team (distribution certs, push keys/certs, pass-type/pay certs,
 * provisioning profiles, ASC API keys) shares ONE leaf; the team's
 * `is_protected` flag AND its project bindings cascade to all of them (spec
 * §1a/§3b). Team-less credentials are always protected and bind per-row.
 */
export type ObjectRef =
  | { readonly kind: "org" }
  | {
      readonly kind: "appleCredential";
      readonly appleTeamId: string;
      readonly credentialId?: string;
    }
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
  | {
      readonly kind: "channel";
      readonly projectId: string;
      readonly environment: string;
      readonly channelId: string;
    }
  | {
      readonly kind: "update";
      readonly projectId: string;
      readonly environment: string;
      readonly channelId: string;
      readonly updateId?: string;
    }
  | {
      readonly kind: "rollout";
      readonly projectId: string;
      readonly environment: string;
      readonly channelId: string;
      readonly rolloutId?: string;
    };

/** Sentinel `projectId` for ORG-GLOBAL env vars (write = org admin, spec §2). */
export const GLOBAL_ENV_VAR_PROJECT_ID = "global";
