// Managed (virtual, code-defined) policies. There is exactly ONE: managed:admin
// — the org Admin role. It is NOT a row; resolving the attachment id reads its
// document from here (zero query). Everything finer-grained is a CUSTOM policy
// (see docs/specs/authz/POLICY-GROUPS-SPEC.md).
//
// `owner` is intentionally absent: it maps to the `member.role === "owner"` root
// bypass in auth/policy.ts, not to a policy. Protected environments stay
// enforced by the assertAccess guard (`environment:update` on the environment
// path) — admin holds every token org-wide; custom policies can grant targeted
// overrides.

import { permissions } from "./permissions";

import type { Action, PolicyDocument, PolicyModel, Resource } from "../models";

export const MANAGED_POLICY_PREFIX = "managed:" as const;

export const ADMIN_POLICY_ID = "managed:admin" as const;
export type ManagedPolicyId = typeof ADMIN_POLICY_ID;

const presetFrom = (perm: Partial<Record<Resource, readonly Action[]>>): PolicyDocument => ({
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Object.entries widens keys to string; source is already typed Partial<Record<Resource, Action[]>>
  statements: (Object.entries(perm) as [Resource, readonly Action[]][]).map(
    ([resource, actions]) => ({
      effect: "allow",
      actions: actions.map((act) => `${resource}:${act}`),
      resources: ["*"],
    }),
  ),
});

const EPOCH = "1970-01-01T00:00:00.000Z";

const ADMIN_POLICY: PolicyModel = {
  id: ADMIN_POLICY_ID,
  organizationId: "*",
  name: "Admin",
  description:
    "Full organization administration: members, access control, projects, credentials, billing.",
  document: presetFrom(permissions.admin),
  createdAt: EPOCH,
  updatedAt: null,
};

/** The managed entries served by the policies list endpoint. */
export const MANAGED_POLICY_LIST: readonly PolicyModel[] = [ADMIN_POLICY];

export const isManagedPolicyId = (id: string): id is ManagedPolicyId => id === ADMIN_POLICY_ID;

/** Virtual PolicyModel for a managed id, else `null`. */
export const managedPolicyModel = (id: string): PolicyModel | null =>
  isManagedPolicyId(id) ? ADMIN_POLICY : null;

/** Document for a managed id, else `null`. */
export const resolveManagedDocument = (id: string): PolicyDocument | null =>
  isManagedPolicyId(id) ? ADMIN_POLICY.document : null;
