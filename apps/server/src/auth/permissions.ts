// Preset permission maps backing the MANAGED policies (admin/developer/viewer)
// and the owner root. These are the SINGLE SOURCE for managed-policy content —
// `auth/managed-policies.ts` turns each entry into an org-wide (`*`) allow
// document. The runtime gate is `assertAccess` in `auth/policy.ts`.
//
// `owner` is NOT a managed policy: it maps to the `member.role === "owner"` root
// bypass. Its entry here documents the full action surface for reference + tests.

import { assertAccess, assertSuperadmin } from "./policy";

import type { Action, BuiltinRole, Resource } from "../models";

// Org-level convenience over `assertAccess` (target defaults to `{ kind: "org" }`).
// Use for genuinely org-scoped resources (member, billing, apiKey, devices,
// webhooks, vault, credentials, audit). Object-scopeable resources call
// `assertAccess` directly with a structured `ObjectRef`.
export const assertPermission = (resource: Resource, action: Action) =>
  assertAccess(resource, action);

export { assertSuperadmin };

type PermissionMap = Record<BuiltinRole, Partial<Record<Resource, readonly Action[]>>>;

// IAM-enforced via dedicated ManagementApi handler groups (the unified-authz
// migration): `apiKey` (api-keys group — mint/revoke/list), `invitation`
// (invitations group — create/cancel/list, member-only invites), `member:delete`
// (members group — remove, with a last-owner guard), and `organization:update`
// (organization group — rename/re-slug the active org). The matching better-auth
// routes stay live-but-dormant (clients use IAM); better-auth's apiKey plugin is
// kept only for verifyApiKey.
//
// RESERVED / NOT-YET-IAM-enforced (a policy may list these tokens, but no handler
// gates on them today):
//   - `organization:delete` + `organization:create`: org CREATE is a pre-org
//     platform gate IAM cannot evaluate (no actor/org context); org DELETE stays on
//     better-auth (owner-only) because its destructive cross-table cascade
//     (projects, api keys, …) is delegated there. Both documented in auth.ts.
//   - `member:read`/`member:create`/`member:update`: membership joins via invite
//     accept (better-auth, session-gated); only member:delete is IAM-gated.
//   - credential resources (apple*/android*/google*/iosBundle*/iosAppMetadata):
//     gated org-level via `assertPermission` (see the `credential` ObjectRef note
//     in authz-models.ts). The presets enumerate them for completeness + future use.
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
    rollout: ["read", "create", "update", "delete"],
    billing: ["read", "update"],
    apiKey: ["read", "create", "delete"],
    build: ["read", "create", "delete"],
    envVar: ["read", "create", "update", "delete"],
    auditLog: ["read"],
    device: ["read", "create", "update", "delete"],
    webhook: ["read", "create", "update", "delete"],
    appleCredential: ["read", "create", "update", "delete", "download"],
    androidCredential: ["read", "create", "update", "delete", "download"],
    iosBundleConfiguration: ["read", "create", "update", "delete"],
    iosAppMetadata: ["read", "create", "update", "delete"],
    submission: ["read", "create", "update", "delete", "cancel"],
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
    rollout: ["read", "create", "update", "delete"],
    billing: ["read", "update"],
    apiKey: ["read", "create", "delete"],
    build: ["read", "create", "delete"],
    envVar: ["read", "create", "update", "delete"],
    auditLog: ["read"],
    device: ["read", "create", "update", "delete"],
    webhook: ["read", "create", "update", "delete"],
    appleCredential: ["read", "create", "update", "delete", "download"],
    androidCredential: ["read", "create", "update", "delete", "download"],
    iosBundleConfiguration: ["read", "create", "update", "delete"],
    iosAppMetadata: ["read", "create", "update", "delete"],
    submission: ["read", "create", "update", "delete", "cancel"],
    vaultAccess: ["read", "create", "delete"],
  },
  developer: {
    project: ["read", "create"],
    channel: ["read", "create", "update", "delete"],
    branch: ["read", "create", "update", "delete"],
    environment: ["read", "create", "update", "delete"],
    update: ["read", "create", "delete"],
    rollout: ["read", "create", "update", "delete"],
    apiKey: ["read"],
    build: ["read", "create"],
    envVar: ["read", "create", "update"],
    auditLog: ["read"],
    device: ["read", "create", "update"],
    webhook: ["read", "create", "update"],
    appleCredential: ["read", "create", "update", "download"],
    androidCredential: ["read", "create", "update", "download"],
    iosBundleConfiguration: ["read", "create", "update"],
    iosAppMetadata: ["read", "create", "update"],
    submission: ["read", "create", "update", "cancel"],
    vaultAccess: ["read"],
  },
  viewer: {
    organization: ["read"],
    member: ["read"],
    policy: ["read"],
    group: ["read"],
    project: ["read"],
    channel: ["read"],
    branch: ["read"],
    environment: ["read"],
    update: ["read"],
    rollout: ["read"],
    build: ["read"],
    envVar: ["read"],
    auditLog: ["read"],
    device: ["read"],
    webhook: ["read"],
    appleCredential: ["read"],
    androidCredential: ["read"],
    iosBundleConfiguration: ["read"],
    iosAppMetadata: ["read"],
    submission: ["read"],
    // No `vaultAccess`: a viewer is a read-only org observer and must NOT touch
    // the credential vault. Granting `vaultAccess:read` would let a viewer fetch
    // their own wrap, self-link a device wrap, and enrol a device key — the
    // low-privilege foothold for a vault escalation. Vault participation starts
    // at `developer`. See docs/specs/build/10-vault-lifecycle-revocation.md §2.
  },
};
