import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

import { permissions } from "./permissions";

import type { BuiltinRole } from "../models";

// -- Derivation helpers (single source of truth = permissions.ts) -----------

/**
 * Collapse the static permission map into a better-auth `Statements` object:
 * `{ resource: union-of-every-action-any-role-grants }`. This is the SUPERSET of
 * actions per resource — the menu of grantable permissions, not a per-role grant.
 * Merged with better-auth's org `defaultStatements` (organization/member/
 * invitation/team/ac) so the org built-ins (esp. `ac`, required for dynamic AC)
 * stay present.
 */
export const buildStatement = (): Record<string, readonly string[]> => {
  const acc = Object.values(permissions)
    .flatMap((resourceMap) => Object.entries(resourceMap))
    .reduce<Record<string, Set<string>>>((result, [resource, actions]) => {
      const set = result[resource] ?? new Set<string>();
      actions.forEach((action) => set.add(action));
      result[resource] = set;
      return result;
    }, {});
  return Object.fromEntries(
    Object.entries(acc).map(([resource, set]) => [resource, [...set]] as const),
  );
};

// `defaultStatements` first so our same-named resources (organization/member/
// invitation) override with our richer action sets; `team` + `ac` survive from
// the defaults (and we also re-supply `ac` via permissions.ts owner/admin).
export const statement = {
  ...defaultStatements,
  ...buildStatement(),
} as const;

export const ac = createAccessControl(statement);

/**
 * Build one better-auth `Role` from a single role's slice of permissions.ts.
 * `ac.newRole(perm)` === `role(perm)`; the literal `{resource: actions}` map is
 * exactly what the static map already holds.
 */
const buildRole = (role: BuiltinRole) => {
  const perm: Record<string, readonly string[]> = Object.fromEntries(
    Object.entries(permissions[role]).map(
      ([resource, actions]) => [resource, [...actions]] as const,
    ),
  );
  return ac.newRole(perm);
};

export const owner = buildRole("owner");
export const admin = buildRole("admin");
export const developer = buildRole("developer");
export const viewer = buildRole("viewer");

/**
 * Name -> Role. Passed to `organization({ roles })`. NOTE: supplying `roles`
 * REPLACES better-auth's default name set used by guard logic, so the built-in
 * `member` name is intentionally dropped — our role set is owner/admin/developer/
 * viewer. `creatorRole: "owner"` stays valid (owner is present).
 */
export const acRoles = { owner, admin, developer, viewer } as const;
