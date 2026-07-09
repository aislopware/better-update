import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { canReadAppleTeamCredentials } from "../auth/apple-team-access";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertAccessAny, assertOrgAdmin } from "../auth/policy";
import { toApiAppleTeamWithCounts } from "../http/to-api";
import { toApiCrudEffect, toApiForbiddenEffect } from "../http/to-api-effect";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";

// Toggle the protected-team flag (GITLAB-RBAC-SPEC §3b) — org admin only,
// idempotent, audit-logged. The flag gates team-level interactions (creating
// credentials under the team, devices) and seeds new child rows' own flags;
// it does NOT touch existing children, which keep their per-row toggles.
const setProtectionEffect = (id: string, isProtected: boolean) =>
  toApiCrudEffect(
    Effect.gen(function* () {
      const repo = yield* AppleTeamRepo;
      const team = yield* repo.findById({ id });
      yield* assertOrgOwnership(team.organizationId);
      yield* assertOrgAdmin;
      const ctx = yield* CurrentActor;
      yield* repo.setProtection({
        id,
        organizationId: ctx.organizationId,
        isProtected,
        now: new Date().toISOString(),
      });
      yield* logAudit({
        action: isProtected ? "appleTeam.protect" : "appleTeam.unprotect",
        resourceType: "appleCredential",
        resourceId: id,
        metadata: { appleTeamId: team.appleTeamId },
      });
      const counted = yield* repo.listWithCounts({ organizationId: ctx.organizationId });
      const updated = counted.find((candidate) => candidate.id === id);
      if (updated === undefined) {
        return yield* Effect.die(new Error("Apple team vanished during protection toggle"));
      }
      const bindings = yield* ProjectCredentialBindingRepo;
      const bound = yield* bindings.boundProjectIds({
        organizationId: ctx.organizationId,
        resourceType: "appleTeam",
        resourceId: id,
      });
      const orgWide = yield* bindings.findAllProjectsBinding({
        organizationId: ctx.organizationId,
        resourceType: "appleTeam",
        resourceId: id,
      });
      return toApiAppleTeamWithCounts(updated, bound, orgWide !== null);
    }),
  );

export const AppleTeamsGroupLive = HttpApiBuilder.group(ManagementApi, "appleTeams", (handlers) =>
  handlers
    .handle("list", () =>
      toApiForbiddenEffect(
        Effect.gen(function* () {
          // Coarse gate (403 for zero-access actors), then per-team filtering:
          // protected teams stay visible only to Maintainer+ (authz-models.ts
          // "APPLE-TEAM axis").
          yield* assertAccessAny("appleCredential", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* AppleTeamRepo;
          const teams = yield* repo.listWithCounts({ organizationId: ctx.organizationId });
          const bindingsRepo = yield* ProjectCredentialBindingRepo;
          const bindings = yield* bindingsRepo.boundProjectIdsByResource({
            organizationId: ctx.organizationId,
            resourceType: "appleTeam",
          });
          const orgWide = new Set(
            yield* bindingsRepo.allProjectsResourceIds({
              organizationId: ctx.organizationId,
              resourceType: "appleTeam",
            }),
          );
          const visible = teams.filter((team) =>
            canReadAppleTeamCredentials(ctx, team, bindings[team.id] ?? []),
          );
          return {
            items: visible.map((team) =>
              toApiAppleTeamWithCounts(team, bindings[team.id] ?? [], orgWide.has(team.id)),
            ),
          };
        }),
      ),
    )
    .handle("protect", ({ path }) => setProtectionEffect(path.id, true))
    .handle("unprotect", ({ path }) => setProtectionEffect(path.id, false)),
);
