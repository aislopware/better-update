// Managed (virtual, code-defined) policies: admin / developer / viewer. They are
// NOT rows — resolving a "managed:*" attachment reads its document from here,
// preserving the zero-query baseline the built-in roles had. Derived from the
// preset maps in permissions.ts → one org-wide (`*`) allow statement per
// resource. See docs/specs/authz/POLICY-GROUPS-SPEC.md §5.
//
// `owner` is intentionally absent: it maps to the `member.role === "owner"` root
// bypass in auth/policy.ts, not to a policy.

import { permissions } from "./permissions";

import type { Action, PolicyDocument, PolicyModel, Resource } from "../models";

export const MANAGED_POLICY_PREFIX = "managed:" as const;

const MANAGED_PRESET_NAMES = ["admin", "developer", "viewer"] as const;
type ManagedPresetName = (typeof MANAGED_PRESET_NAMES)[number];
export type ManagedPolicyId = `managed:${ManagedPresetName}`;

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

const virtualPolicy = (
  id: ManagedPolicyId,
  name: string,
  document: PolicyDocument,
): PolicyModel => ({
  id,
  organizationId: "*",
  name,
  description: `Managed preset: ${name}`,
  document,
  createdAt: EPOCH,
  updatedAt: null,
});

export const MANAGED_POLICIES: Record<ManagedPolicyId, PolicyModel> = {
  "managed:admin": virtualPolicy("managed:admin", "Admin", presetFrom(permissions.admin)),
  "managed:developer": virtualPolicy(
    "managed:developer",
    "Developer",
    presetFrom(permissions.developer),
  ),
  "managed:viewer": virtualPolicy("managed:viewer", "Viewer", presetFrom(permissions.viewer)),
};

export const MANAGED_POLICY_LIST: readonly PolicyModel[] = Object.values(MANAGED_POLICIES);

export const isManagedPolicyId = (id: string): id is ManagedPolicyId =>
  id.startsWith(MANAGED_POLICY_PREFIX) && id in MANAGED_POLICIES;

/** Document for a managed preset id, or `null` if not a managed id. */
export const resolveManagedDocument = (id: string): PolicyDocument | null =>
  isManagedPolicyId(id) ? MANAGED_POLICIES[id].document : null;
