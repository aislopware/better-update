import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { actionMatches, isAllowed, resolvePath } from "../auth/policy-match";
import { AuthMetaRepo } from "../repositories/auth-meta";

import type { CurrentActor as CurrentActorModel } from "../models";

const ORG_PATH = resolvePath({ kind: "org" });

/**
 * Whether the actor holds `token` on `org` — owner/superadmin are unconditional
 * roots (same bypass order as `assertAccess`), otherwise it mirrors the EXACT
 * token the corresponding member-management endpoint gates on, so a UI affordance
 * keyed off this never shows an action the server would 403.
 */
export const actorHolds = (ctx: CurrentActorModel, token: string): boolean =>
  ctx.isSuperadmin || ctx.isOwner || isAllowed(ctx.effectiveStatements, token, ORG_PATH);

// Org-wide env vars live under `project/global/...`, not `org` — gate the
// sidebar entry off `envVar:read` there (matched by `*`, `project/*`, and
// `project/global...` selectors alike).
const holdsOrgEnvVarRead = (ctx: CurrentActorModel): boolean =>
  ctx.isSuperadmin ||
  ctx.isOwner ||
  isAllowed(ctx.effectiveStatements, "envVar:read", "project/global");

// Apple credentials are scoped by APPLE TEAM, not the org path — show the
// credentials surface when the actor can read them ANYWHERE (mirrors
// `assertAccessAny`, which gates the list endpoints; those then filter to the
// actor's teams).
const holdsAppleCredentialReadAnywhere = (ctx: CurrentActorModel): boolean =>
  ctx.isSuperadmin ||
  ctx.isOwner ||
  ctx.effectiveStatements.some(
    (statement) =>
      statement.effect === "allow" && actionMatches(statement.actions, "appleCredential:read"),
  );

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
        // Sidebar/chrome capability contract (ROLES-CAPABILITIES-SPEC §5b).
        // Hiding is UX only — `assertAccess` still guards every endpoint.
        canInviteMembers: actorHolds(ctx, "invitation:create"),
        canRemoveMembers: actorHolds(ctx, "member:delete"),
        canManagePolicies: actorHolds(ctx, "policy:update"),
        canViewPolicies: actorHolds(ctx, "policy:read"),
        canViewAuditLog: actorHolds(ctx, "auditLog:read"),
        canViewCredentials: holdsAppleCredentialReadAnywhere(ctx),
        canViewDevices: actorHolds(ctx, "device:read"),
        canViewVaultAccess: actorHolds(ctx, "vaultAccess:read"),
        canViewRobots: actorHolds(ctx, "robotAccount:read"),
        canManageOrgEnvVars: holdsOrgEnvVarRead(ctx),
        canManageOrgSettings: actorHolds(ctx, "organization:update"),
      };
    }),
  ),
);
