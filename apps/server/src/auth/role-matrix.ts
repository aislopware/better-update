// The GitLab-style RBAC matrix (docs/specs/authz/GITLAB-RBAC-SPEC.md §2).
// Pure data + pure functions — no I/O, no Effect services; unit-tested
// directly against the spec tables. This module is the SINGLE SOURCE for
// "which rank may do what"; the runtime gate is `assertAccess` in
// `auth/policy.ts`, credential helpers in `auth/apple-team-access.ts` /
// `auth/android-credential-access.ts` consume CREDENTIAL_RULES +
// `boundCredentialAllowed` (v2 binding gate, spec §1a).

import type { Action, OrgRole, ProjectRole, Resource } from "../models";

// Fixed ladders (types in packages/api auth/context — shared with the
// AuthContextShape). Org: owner (root, undeniable) > admin (org management +
// implicit maintainer on every project) > member (baseline; access comes from
// project_member rows). Project: maintainer > developer > reporter.
export type { OrgRole, ProjectRole };

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  reporter: 1,
  developer: 2,
  maintainer: 3,
};

export const projectRoleAtLeast = (role: ProjectRole | null, min: ProjectRole): boolean =>
  role !== null && PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[min];

export const maxProjectRole = (
  left: ProjectRole | null,
  right: ProjectRole | null,
): ProjectRole | null => {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return PROJECT_ROLE_RANK[left] >= PROJECT_ROLE_RANK[right] ? left : right;
};

/** The principal's authz inputs, resolved once per request (auth/middleware). */
export interface RoleContext {
  readonly orgRole: OrgRole;
  /** Raw `project_member` rows: projectId → role. Empty for owner/admin. */
  readonly projectRoles: Readonly<Record<string, ProjectRole>>;
}

/**
 * Effective role on ONE project: org owner/admin are implicit maintainers
 * everywhere; otherwise the membership row decides (absent row = no access,
 * which callers surface as 404 via the ownership guards).
 */
export const effectiveProjectRole = (ctx: RoleContext, projectId: string): ProjectRole | null => {
  if (ctx.orgRole === "owner" || ctx.orgRole === "admin") {
    return "maintainer";
  }
  const role = ctx.projectRoles[projectId];
  return role === undefined ? null : role;
};

/**
 * Highest role held ANYWHERE. v2 (spec §1a) retired this as a GRANT for
 * credentials/devices — those now require the rank on a BOUND project
 * ({@link boundCredentialAllowed}). It survives for exactly two uses:
 * org-global env-var reads (shared org config, not a credential) and coarse
 * "can see this surface at all" pre-gates (`assertAccessAny`, /api/me chrome),
 * where the per-row binding filter still decides what is actually visible.
 */
export const anywhereRank = (ctx: RoleContext): ProjectRole | null =>
  ctx.orgRole === "owner" || ctx.orgRole === "admin"
    ? "maintainer"
    : Object.values(ctx.projectRoles).reduce<ProjectRole | null>(maxProjectRole, null);

// -- Project-scoped rules (spec §2, first table) ------------------------------
// token → minimum effective PROJECT role on the target's project. Tokens
// absent from the map are denied for everyone below owner (default-deny).
// Writes additionally pass the archived + protected-environment guards in
// auth/policy.ts.

type Token = `${Resource}:${Action}`;

export const PROJECT_RULES: Partial<Readonly<Record<Token, ProjectRole>>> = {
  "project:read": "reporter",
  "project:update": "maintainer",
  // project:delete is an ORG rule (≥ admin) — see ORG_RULES.

  "branch:read": "reporter",
  "branch:create": "developer",
  "branch:update": "developer",
  "branch:delete": "maintainer",

  "channel:read": "reporter",
  "channel:create": "developer",
  "channel:update": "developer",
  "channel:delete": "maintainer",

  "update:read": "reporter",
  "update:create": "developer",
  "update:delete": "maintainer",

  "rollout:create": "developer",
  "rollout:update": "developer",

  "build:read": "reporter",
  "build:download": "reporter",
  "build:create": "developer",
  "build:delete": "maintainer",

  "submission:read": "reporter",
  "submission:create": "developer",
  "submission:cancel": "developer",
  "submission:delete": "maintainer",

  "envVar:read": "developer",
  "envVar:create": "developer",
  "envVar:update": "developer",
  "envVar:delete": "developer",

  "iosAppMetadata:read": "reporter",
  "iosAppMetadata:create": "developer",
  "iosAppMetadata:update": "developer",
  "iosAppMetadata:delete": "maintainer",

  "iosBundleConfiguration:read": "reporter",
  "iosBundleConfiguration:create": "developer",
  "iosBundleConfiguration:update": "developer",
  "iosBundleConfiguration:delete": "maintainer",

  // Project-scoped android entities (application identifiers + their
  // build-credential groups). The ORG-shared android secrets (upload
  // keystores, Google service-account keys) use ANYWHERE_RULES + the
  // protected-credential ladder instead.
  "androidCredential:read": "reporter",
  "androidCredential:create": "developer",
  "androidCredential:update": "developer",
  "androidCredential:delete": "maintainer",
  "androidCredential:download": "developer",

  // Robot accounts are project-scoped (spec §1b, v2): one robot = one project
  // + one project role. Managing a project's robots is Maintainer work,
  // GitLab project-access-token style. Legacy NULL-project rows fall back to
  // the org-admin gate in the handler.
  "robotAccount:read": "maintainer",
  "robotAccount:create": "maintainer",
  "robotAccount:update": "maintainer",
  "robotAccount:delete": "maintainer",
};

// -- Org-scoped rules (spec §2, second table) ---------------------------------
// Requirement for tokens whose target is the org itself.
//   "member"  — any org member.
//   "admin"   — org admin or owner.
//   "owner"   — owner only.
// Credential/device tokens gated by the anywhere-rank live in ANYWHERE_RULES.

export type OrgRequirement = "member" | "admin" | "owner";

export const ORG_RULES: Partial<Readonly<Record<Token, OrgRequirement>>> = {
  "organization:read": "member",
  "organization:update": "admin",
  // organization:create/:delete stay on better-auth (unchanged, see auth.ts).

  // Member directory is org-visible (GitLab members list); mutations ≥ admin.
  // Granting/revoking admin or owner is owner-only — enforced as an extra
  // handler guard, not a separate token.
  "member:read": "member",
  "member:update": "admin",
  "member:delete": "admin",

  "invitation:read": "admin",
  "invitation:create": "admin",
  "invitation:cancel": "admin",

  // robotAccount:* moved to PROJECT_RULES (spec §1b, v2).

  // Binding an org credential to a project is org administration (spec §1a);
  // the ≥M auto-bind-on-create path is a handler special case, not a rule.
  "credentialBinding:read": "admin",
  "credentialBinding:create": "admin",
  "credentialBinding:delete": "admin",

  "vaultAccess:read": "admin",
  "vaultAccess:create": "admin",
  "vaultAccess:delete": "admin",

  "auditLog:read": "admin",

  "webhook:read": "admin",
  "webhook:create": "admin",
  "webhook:update": "admin",
  "webhook:delete": "admin",

  // Org environment names are structural metadata every surface renders;
  // mutations (incl. the protection toggle) are org administration.
  "environment:read": "member",
  "environment:create": "admin",
  "environment:update": "admin",
  "environment:delete": "admin",

  "billing:read": "owner",
  "billing:update": "owner",

  // Any org member may create a project; the creator is auto-added as its
  // maintainer (spec §2a-1, owner decision 2026-07-03).
  "project:create": "member",
  // Deleting a project is org-level destruction, above maintainer.
  "project:delete": "admin",
};

// -- Bound-credential rules (spec §1a/§3b, v2) --------------------------------
// Org-shared build inputs (credentials + devices): the listed rank must be
// held on SOME project the credential/device's team is BOUND to
// ({@link boundCredentialAllowed}); an unbound row is admin-only. For
// credentials the listed rank applies to NON-protected rows; a protected row
// (team flag, per-key flag, or team-less Apple credentials) raises the
// requirement to PROTECTED_CREDENTIAL_MIN_ROLE for every action.

export const CREDENTIAL_RULES: Partial<Readonly<Record<Token, ProjectRole>>> = {
  "device:read": "developer",
  "device:create": "developer",
  "device:update": "developer",
  "device:delete": "developer",

  "appleCredential:read": "developer",
  "appleCredential:create": "developer",
  "appleCredential:update": "developer",
  "appleCredential:download": "developer",
  "appleCredential:delete": "maintainer",

  // Org-shared android secrets (upload keystores + GSA keys) when gated at
  // org scope by their handlers.
  "androidCredential:read": "developer",
  "androidCredential:create": "developer",
  "androidCredential:update": "developer",
  "androidCredential:download": "developer",
  "androidCredential:delete": "maintainer",
};

/** Writes to org-global env vars (projectId "global") are admin-only. */
export const orgGlobalEnvVarRequirement = (action: Action): OrgRequirement | "anywhere-read" =>
  action === "read" ? "anywhere-read" : "admin";

export const PROTECTED_CREDENTIAL_MIN_ROLE: ProjectRole = "maintainer";

/**
 * Vault PARTICIPATION (self-service) is distinct from vault ADMINISTRATION
 * (`vaultAccess:*`, org-admin ORG_RULES). Enrolling one's own device/account
 * key, self-linking a wrap, fetching one's wrap, and reading the vault
 * metadata needed to decrypt are open to anyone holding ≥ developer on SOME
 * project — the same anywhere-rank that may read/download credentials and env
 * vars, i.e. exactly the principals who must be able to unlock the vault
 * (humans and robots alike). Reporter-only principals stay out: the viewer
 * escalation guard from the vault-lifecycle spec (docs/specs/build/10 §3)
 * survives as "no build rank anywhere → no recipient key".
 */
export const VAULT_PARTICIPANT_MIN_ROLE: ProjectRole = "developer";

// -- Evaluation helpers --------------------------------------------------------

export const meetsOrgRequirement = (orgRole: OrgRole, requirement: OrgRequirement): boolean => {
  switch (requirement) {
    case "member": {
      return true;
    }
    case "admin": {
      return orgRole === "admin" || orgRole === "owner";
    }
    case "owner": {
      return orgRole === "owner";
    }
    default: {
      return requirement satisfies never;
    }
  }
};

export const meetsAnywhereRequirement = (ctx: RoleContext, min: ProjectRole): boolean =>
  projectRoleAtLeast(anywhereRank(ctx), min);

/**
 * Whether the principal may PARTICIPATE in the org vaults (see
 * {@link VAULT_PARTICIPANT_MIN_ROLE}). Org owner/admin pass via their implicit
 * maintainer-everywhere rank; robots pass via their single project role.
 */
export const isVaultParticipant = (ctx: RoleContext): boolean =>
  meetsAnywhereRequirement(ctx, VAULT_PARTICIPANT_MIN_ROLE);

/**
 * Required rank for a credential row, folding in the protected flag
 * (spec §3b): protected ⇒ maintainer, otherwise the base CREDENTIAL_RULES
 * entry.
 */
export const credentialRequiredRank = (baseRank: ProjectRole, isProtected: boolean): ProjectRole =>
  isProtected ? PROTECTED_CREDENTIAL_MIN_ROLE : baseRank;

/**
 * The v2 binding gate (spec §1a): an org credential/device action is allowed
 * iff the actor is org admin/owner (implicit maintainer everywhere) or holds
 * `minRank` on SOME project the resource is bound to. An empty binding set
 * therefore means admin-only. Superadmin is bypassed by callers, as
 * everywhere else.
 */
export const boundCredentialAllowed = (
  ctx: RoleContext,
  boundProjectIds: readonly string[],
  minRank: ProjectRole,
): boolean =>
  ctx.orgRole === "owner" ||
  ctx.orgRole === "admin" ||
  boundProjectIds.some((projectId) =>
    projectRoleAtLeast(effectiveProjectRole(ctx, projectId), minRank),
  );
