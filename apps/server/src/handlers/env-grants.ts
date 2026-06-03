import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type {
  EnvGrant as EnvGrantSchema,
  EnvGrantRow as EnvGrantRowSchema,
} from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { statement } from "../auth/access-control";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { buildEnvVarScopeId, ENV_VAR_GLOBAL_SENTINEL, ENV_VAR_SCOPE_KIND } from "../auth/scope";
import { Forbidden, NotFound } from "../errors";
import { toApiReadEffect } from "../http/to-api-effect";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";
import { MemberRepo } from "../repositories/org-role-repo";

import type { EnvironmentGrantModel } from "../authz-models";
import type { EnvVarEnvironment } from "../models";

// Valid resource names a grant action token may reference (the AccessControl
// statement is the full grantable menu). Cached at module scope — `statement`
// is a static derivation of `permissions.ts`.
const VALID_RESOURCES = new Set(Object.keys(statement));

const ACTION_TOKEN = /^[a-z]+:[a-z]+$/iu;

const toApiEnvGrant = (grant: EnvironmentGrantModel): EnvGrantSchema => ({
  id: grant.id,
  memberId: grant.memberId,
  // The `EnvGrant` schema fixes `scopeKind` to the literal "env_var_environment".
  // Every grant this handler creates is written with `ENV_VAR_SCOPE_KIND`, so the
  // model's widened `ScopeKind` field is always that literal here — emit the
  // constant directly to satisfy the narrowed schema type without an assertion.
  scopeKind: ENV_VAR_SCOPE_KIND,
  scopeId: grant.scopeId,
  effect: grant.effect,
  actions: [...grant.actions],
  createdAt: grant.createdAt,
});

// Every token must be a `resource:action` pair whose resource is a real,
// grantable AccessControl resource. Rejects free-form strings before they reach
// the grant store (mirror channel-grants). Surfaced as Forbidden — the
// endpoint's declared error set is { NotFound, Forbidden, BadRequest } and a
// grant for an ungrantable permission token is itself a permission rejection.
const assertValidActionTokens = (actions: readonly string[]) =>
  Effect.gen(function* () {
    const invalid = actions.filter((token) => {
      if (!ACTION_TOKEN.test(token)) {
        return true;
      }
      const [resource] = token.split(":");
      return resource === undefined || !VALID_RESOURCES.has(resource);
    });
    if (invalid.length > 0) {
      return yield* new Forbidden({
        message: `Invalid grant action(s): ${invalid.join(", ")}. Expected "resource:action" with a known resource.`,
      });
    }
  });

// Resolve the project-or-global scope + gate management (member:update — owner/
// admin only, mirroring channel-grants where managing who can act is a
// membership-admin action). For a project scope, tenant-check project ownership;
// for global, the org-wide member:update gate suffices.
const gateScope = (projectId: string | null) =>
  Effect.gen(function* () {
    if (projectId !== null) {
      yield* assertProjectOwnership(projectId);
    }
    yield* assertPermission("member", "update");
  });

// Resolve the request's project segment: a body/query `projectId` that is the
// sentinel "global" (or null) means the org-global vault → null; else a real id.
const resolveProjectId = (raw: string | null): string | null =>
  raw === null || raw === ENV_VAR_GLOBAL_SENTINEL ? null : raw;

export const EnvGrantsGroupLive = HttpApiBuilder.group(ManagementApi, "envGrants", (handlers) =>
  handlers
    .handle("list", ({ urlParams }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          const projectId = resolveProjectId(urlParams.projectId);
          yield* gateScope(projectId);

          const grantRepo = yield* EnvironmentGrantRepo;

          // One read per environment scope id (3 environments). D1 caps a compound
          // SELECT at 5 UNION terms, so 3 separate findByScope calls are simplest.
          const environments: readonly EnvVarEnvironment[] = [
            "development",
            "preview",
            "production",
          ];
          // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array.forEach; the second arg is a mapping effect, not a thisArg
          const perEnv = yield* Effect.forEach(environments, (environment) =>
            Effect.map(
              grantRepo.findByScope({
                scopeKind: ENV_VAR_SCOPE_KIND,
                scopeId: buildEnvVarScopeId(projectId, environment),
              }),
              (grants) =>
                grants.map((grant) => ({
                  memberId: grant.memberId,
                  environment,
                  effect: grant.effect,
                  actions: [...grant.actions],
                })),
            ),
          );
          return perEnv.flat() satisfies EnvGrantRowSchema[];
        }),
      ),
    )
    .handle("upsert", ({ payload }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          const projectId = resolveProjectId(payload.projectId);
          yield* gateScope(projectId);
          const ctx = yield* CurrentActor;

          // The grant target must be a member of the acting org (anti-enumeration
          // + FK integrity). NotFound for a non-member or cross-org member id.
          const memberRepo = yield* MemberRepo;
          const memberOrgId = yield* memberRepo.findOrgId({ memberId: payload.memberId });
          if (memberOrgId !== ctx.organizationId) {
            return yield* new NotFound({ message: "Member not found" });
          }

          yield* assertValidActionTokens(payload.actions);

          const grantRepo = yield* EnvironmentGrantRepo;
          const grant = yield* grantRepo.upsert({
            organizationId: ctx.organizationId,
            memberId: payload.memberId,
            scopeKind: ENV_VAR_SCOPE_KIND,
            scopeId: buildEnvVarScopeId(projectId, payload.environment),
            effect: payload.effect,
            actions: payload.actions,
          });

          yield* logAudit({
            action: "envVar.grant.set",
            resourceType: "envVar",
            resourceId: grant.id,
            ...(projectId ? { projectId } : {}),
            metadata: {
              memberId: payload.memberId,
              environment: payload.environment,
              scope: projectId ?? ENV_VAR_GLOBAL_SENTINEL,
              effect: payload.effect,
              actions: [...payload.actions],
            },
          });

          return toApiEnvGrant(grant);
        }),
      ),
    )
    .handle("delete", ({ payload }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          const projectId = resolveProjectId(payload.projectId);
          yield* gateScope(projectId);

          const grantRepo = yield* EnvironmentGrantRepo;
          yield* grantRepo.deleteForMemberOnScope({
            memberId: payload.memberId,
            scopeKind: ENV_VAR_SCOPE_KIND,
            scopeId: buildEnvVarScopeId(projectId, payload.environment),
          });

          yield* logAudit({
            action: "envVar.grant.revoke",
            resourceType: "envVar",
            resourceId: buildEnvVarScopeId(projectId, payload.environment),
            ...(projectId ? { projectId } : {}),
            metadata: {
              memberId: payload.memberId,
              environment: payload.environment,
              scope: projectId ?? ENV_VAR_GLOBAL_SENTINEL,
            },
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
