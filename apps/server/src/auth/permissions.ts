// Preset permission maps backing the MANAGED policies and the owner root
// (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md). These are the SINGLE SOURCE
// for managed-policy content — `auth/managed-policies.ts` turns each entry into
// an allow document. The runtime gate is `assertAccess` in `auth/policy.ts`.
//
// Two maps: `permissions.owner` documents the root-bypass surface (reference +
// tests + the policy-builder vocabulary); `permissions.admin` backs
// `managed:admin` — the ONLY managed policy. Fine-grained access is granted via
// CUSTOM policies (statements + path selectors), never role presets.

import { assertAccess, assertSuperadmin } from "./policy";

import type { Action, PolicyStatement, Resource } from "../models";

// Org-level convenience over `assertAccess` (target defaults to `{ kind: "org" }`).
// Use for genuinely org-scoped resources (member, billing, robotAccount, devices,
// webhooks, vault, credentials, audit). Object-scopeable resources call
// `assertAccess` directly with a structured `ObjectRef`.
export const assertPermission = (resource: Resource, action: Action) =>
  assertAccess(resource, action);

export { assertSuperadmin };

type PermissionMap = Record<"owner" | "admin", Partial<Record<Resource, readonly Action[]>>>;

// IAM-enforced via dedicated ManagementApi handler groups (the unified-authz
// migration): `robotAccount` (robot-accounts group — mint/revoke/list),
// `invitation` (invitations group — create/cancel/list, member-only invites),
// `member:delete` (members group — remove, with a last-owner guard), and
// `organization:update` (organization group — rename/re-slug the active org).
// The matching better-auth routes stay live-but-dormant (clients use IAM).
//
// RESERVED / NOT-YET-IAM-enforced (a policy may list these tokens, but no handler
// gates on them today):
//   - `organization:delete` + `organization:create`: org CREATE is a pre-org
//     platform gate IAM cannot evaluate (no actor/org context); org DELETE stays on
//     better-auth (owner-only) because its destructive cross-table cascade
//     (projects, api keys, …) is delegated there. Both documented in auth.ts.
//   - `member:read`/`member:create`/`member:update`: membership joins via invite
//     accept (better-auth, session-gated); only member:delete is IAM-gated.
//   - `billing:read`/`billing:update`: forward-declared for the not-yet-built
//     Polar billing integration; no handler gates on them today.
//   - `iosBundleConfiguration`/`iosAppMetadata`: OBJECT-SCOPED per project — the
//     handlers gate at `project/{id}` via `assertAccess`.
//   - `androidCredential`: MIXED-scope. The per-project entities (application
//     identifiers + their build-credential groups) gate at `project/{id}`; the
//     org-shared secrets (upload keystores + Google service-account keys, reused
//     across projects like Apple team certs) stay org-level via
//     `assertPermission`. `build-credentials resolve` gates android download at
//     the build's `project/{id}`.
//   - `appleCredential`: OBJECT-SCOPED by Apple team — the handlers gate at
//     `appleTeam/{T}/credential[/{id}]` via auth/apple-team-access.ts, so a
//     custom policy can grant one team's credentials without the rest.
export const permissions: PermissionMap = {
  owner: {
    organization: ["read", "update", "delete"],
    member: ["read", "create", "update", "delete"],
    invitation: ["read", "create", "cancel"],
    policy: ["read", "create", "update", "delete"],
    group: ["read", "create", "update", "delete"],
    project: ["read", "create", "update", "delete"],
    channel: ["read", "create", "update", "delete"],
    branch: ["read", "create", "update", "delete"],
    environment: ["read", "create", "update", "delete"],
    update: ["read", "create", "delete"],
    rollout: ["create", "update"],
    billing: ["read", "update"],
    robotAccount: ["read", "create", "update", "delete"],
    build: ["read", "create", "delete"],
    envVar: ["read", "create", "update", "delete"],
    auditLog: ["read"],
    device: ["read", "create", "update", "delete"],
    webhook: ["read", "create", "update", "delete"],
    appleCredential: ["read", "create", "update", "delete", "download"],
    androidCredential: ["read", "create", "update", "delete", "download"],
    iosBundleConfiguration: ["read", "create", "update", "delete"],
    iosAppMetadata: ["read", "create", "update", "delete"],
    submission: ["read", "create", "delete"],
    vaultAccess: ["read", "create", "delete"],
  },
  admin: {
    organization: ["read"],
    member: ["read", "create", "update", "delete"],
    invitation: ["read", "create", "cancel"],
    policy: ["read", "create", "update", "delete"],
    group: ["read", "create", "update", "delete"],
    project: ["read", "create", "update", "delete"],
    channel: ["read", "create", "update", "delete"],
    branch: ["read", "create", "update", "delete"],
    environment: ["read", "create", "update", "delete"],
    update: ["read", "create", "delete"],
    rollout: ["create", "update"],
    billing: ["read", "update"],
    // `update` = bearer rotation: handing out an existing robot's NEW secret is
    // an identity takeover, so it is a separate token from `create` and is
    // additionally boundary-checked in the handler (see robot-accounts.ts).
    robotAccount: ["read", "create", "update", "delete"],
    build: ["read", "create", "delete"],
    envVar: ["read", "create", "update", "delete"],
    auditLog: ["read"],
    device: ["read", "create", "update", "delete"],
    webhook: ["read", "create", "update", "delete"],
    appleCredential: ["read", "create", "update", "delete", "download"],
    androidCredential: ["read", "create", "update", "delete", "download"],
    iosBundleConfiguration: ["read", "create", "update", "delete"],
    iosAppMetadata: ["read", "create", "update", "delete"],
    submission: ["read", "create", "delete"],
    vaultAccess: ["read", "create", "delete"],
  },
};

// -- Member baseline (SPEC §2a) -----------------------------------------------
// Appended in code for every member session (never an attachment row; robots
// get NO baseline). Joining an org grants org metadata reads only:
// `organization:read` (org name/slug) and `environment:read` (environment
// NAMES — org-structural metadata every project surface needs to render).

export const MEMBER_BASELINE_STATEMENTS: readonly PolicyStatement[] = [
  { effect: "allow", actions: ["organization:read", "environment:read"], resources: ["org"] },
];
