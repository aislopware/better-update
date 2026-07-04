import { meQueryOptions } from "@better-update/api-client/react";
import { redirect } from "@tanstack/react-router";

import type { MeResult } from "@better-update/api-client/react";
import type { QueryClient } from "@tanstack/react-query";

// Client-side mirror of the server's superadmin/approval gate. The Better Auth
// `admin` plugin stores the global role as a (possibly comma-separated) string;
// `role = "admin"` marks a superadmin. Unapproved non-superadmins are held at
// `/pending-approval` until a superadmin approves them.

interface AccessUser {
  readonly role?: string | null | undefined;
  readonly approved?: boolean | null | undefined;
}

export const isSuperadminUser = (user: AccessUser): boolean =>
  typeof user.role === "string" &&
  user.role
    .split(",")
    .map((part) => part.trim())
    .includes("admin");

export const isApprovedUser = (user: AccessUser): boolean =>
  user.approved === true || isSuperadminUser(user);

// Org-management rank check (GITLAB-RBAC-SPEC §1): owner and admin share the
// org-management surface (protection toggles, project-member management, …).
export const isOrgAdmin = (orgRole: MeResult["orgRole"]): boolean =>
  orgRole === "owner" || orgRole === "admin";

// Capability route guard (GITLAB-RBAC-SPEC §4c): capability-gated org pages
// redirect to /projects when the actor lacks the corresponding /api/me
// capability. UX only — every endpoint stays IAM-gated server-side.
export type MeCapability = keyof Pick<
  MeResult,
  | "canViewAuditLog"
  | "canViewCredentials"
  | "canViewDevices"
  | "canViewVaultAccess"
  | "canViewRobots"
  | "canManageOrgEnvVars"
  | "canManageOrgSettings"
>;

export const assertCapability = async (
  queryClient: QueryClient,
  capability: MeCapability,
): Promise<void> => {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!me[capability]) {
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed `to` inference
    throw redirect({ to: "/projects" });
  }
};
