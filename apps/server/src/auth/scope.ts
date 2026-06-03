import { Effect } from "effect";

import { Forbidden } from "../errors";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";
import { CurrentActor } from "./current-actor";

import type { ScopeKind } from "../authz-models";
import type { Action, EnvVarEnvironment, Resource } from "../models";

export interface Scope {
  // `scopeKind` is "channel" in v1; `scopeId` is the channel id.
  readonly scopeKind: ScopeKind;
  readonly scopeId: string;
}

export type { ScopeKind };

/**
 * Per-scope (ABAC) gate. DENY-WINS hybrid:
 *   1. matching DENY grant on this scope -> Forbidden
 *   2. else role baseline (ctx.effectivePermissions) allows -> allow
 *   3. else matching ALLOW grant on this scope -> allow
 *   4. else -> Forbidden
 * Grants are read LAZILY here (per check), never preloaded into the auth context.
 * API-key actors (no member id) have no grants in v1: steps 1 and 3 short-circuit
 * to "no grants", so resolution reduces to the role/metadata baseline (step 2)
 * only.
 */
export const assertPermissionOn = (resource: Resource, action: Action, scope: Scope) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const token = `${resource}:${action}`;

    // No member identity (API key) -> baseline only; no allow/deny grants apply.
    const { memberId } = ctx;
    if (!memberId) {
      const baseline = ctx.effectivePermissions[resource]?.includes(action) ?? false;
      if (!baseline) {
        return yield* new Forbidden({ message: `Insufficient permission: ${token}` });
      }
      return;
    }

    const repo = yield* EnvironmentGrantRepo;
    const grants = yield* repo.findForMemberOnScope({
      memberId,
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
    });

    const denied = grants.some((grant) => grant.effect === "deny" && grant.actions.includes(token));
    if (denied) {
      return yield* new Forbidden({ message: `Denied by scope grant: ${token}` });
    }

    // Role baseline grants it and no deny overrode -> allow.
    const baseline = ctx.effectivePermissions[resource]?.includes(action) ?? false;
    if (baseline) {
      return;
    }

    const allowed = grants.some(
      (grant) => grant.effect === "allow" && grant.actions.includes(token),
    );
    if (!allowed) {
      return yield* new Forbidden({ message: `Insufficient permission: ${token}` });
    }
  });

/** Sentinel project-id segment for an org-global env-var scope. */
export const ENV_VAR_GLOBAL_SENTINEL = "global" as const;

/** scope_kind value for per (project × environment) env-var grants. */
export const ENV_VAR_SCOPE_KIND = "env_var_environment" as const;

/**
 * Build the `env_var_environment` scope id from (projectId-or-null, environment).
 * `null` projectId means the org-global vault → the `ENV_VAR_GLOBAL_SENTINEL`
 * segment. Format: `<projectId|global>:<environment>`.
 */
export const buildEnvVarScopeId = (
  projectId: string | null,
  environment: EnvVarEnvironment,
): string => `${projectId ?? ENV_VAR_GLOBAL_SENTINEL}:${environment}`;

/**
 * Inverse of {@link buildEnvVarScopeId}. Returns the project-id segment (or the
 * sentinel) and the environment. Splits on the FIRST colon only — a project id
 * never contains a colon, and the environment is a fixed token, so this is total
 * for well-formed ids.
 */
export const parseEnvVarScopeId = (
  scopeId: string,
): { readonly project: string; readonly environment: string } => {
  const idx = scopeId.indexOf(":");
  return idx === -1
    ? { project: scopeId, environment: "" }
    : { project: scopeId.slice(0, idx), environment: scopeId.slice(idx + 1) };
};
