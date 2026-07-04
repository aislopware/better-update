import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { meetsAnywhereRequirement, meetsOrgRequirement, ORG_RULES } from "../auth/role-matrix";
import { AuthMetaRepo } from "../repositories/auth-meta";

import type { Action, CurrentActor as CurrentActorModel, Resource } from "../models";

/**
 * Whether the actor holds an org-scoped token — owner/superadmin are
 * unconditional roots (same bypass order as `assertAccess`), otherwise it
 * mirrors the EXACT org rule the corresponding endpoint gates on, so a UI
 * affordance keyed off this never shows an action the server would 403.
 */
export const actorHolds = (ctx: CurrentActorModel, resource: Resource, action: Action): boolean => {
  if (ctx.isSuperadmin || ctx.isOwner) {
    return true;
  }
  const requirement = ORG_RULES[`${resource}:${action}`];
  return requirement !== undefined && meetsOrgRequirement(ctx.orgRole, requirement);
};

// Org-shared build inputs (credentials/devices/org env vars): show the
// surface to anyone holding developer anywhere — a coarse chrome gate only;
// the endpoints enforce the per-row binding + protected ladders (spec §1a).
const holdsAnywhereDeveloper = (ctx: CurrentActorModel): boolean =>
  ctx.isSuperadmin || ctx.isOwner || meetsAnywhereRequirement(ctx, "developer");

// Robots are project-scoped (spec §1b, v2): the robots surface is for
// admin-tier actors and anyone maintaining at least one project.
const holdsAnywhereMaintainer = (ctx: CurrentActorModel): boolean =>
  ctx.isSuperadmin || ctx.isOwner || meetsAnywhereRequirement(ctx, "maintainer");

export const MeGroupLive = HttpApiBuilder.group(ManagementApi, "me", (handlers) =>
  handlers.handle("get", () =>
    Effect.gen(function* () {
      const ctx = yield* CurrentActor;
      const repo = yield* AuthMetaRepo;
      const user = ctx.userId === null ? null : yield* repo.findUserById(ctx.userId);
      const organization = yield* repo.findOrganizationById(ctx.organizationId);
      return {
        user: user ? { id: user.id, name: user.name, email: user.email } : null,
        activeOrganization: organization
          ? {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              role: ctx.role,
            }
          : null,
        source: ctx.source,
        actorEmail: ctx.actorEmail,
        orgRole: ctx.orgRole,
        projectRoles: ctx.projectRoles,
        // Sidebar/chrome capability contract. Hiding is UX only —
        // `assertAccess` still guards every endpoint.
        canInviteMembers: actorHolds(ctx, "invitation", "create"),
        canRemoveMembers: actorHolds(ctx, "member", "delete"),
        canManageMembers: actorHolds(ctx, "member", "update"),
        canViewAuditLog: actorHolds(ctx, "auditLog", "read"),
        canViewCredentials: holdsAnywhereDeveloper(ctx),
        canViewDevices: holdsAnywhereDeveloper(ctx),
        canViewVaultAccess: actorHolds(ctx, "vaultAccess", "read"),
        canViewRobots: holdsAnywhereMaintainer(ctx),
        canManageOrgEnvVars: holdsAnywhereDeveloper(ctx),
        canManageOrgSettings: actorHolds(ctx, "organization", "update"),
      };
    }),
  ),
);
