import { Effect } from "effect";

import { Forbidden } from "../errors";
import { CurrentActor } from "./current-actor";
import { actionMatches, isAllowed, resolvePath } from "./policy-match";

import type { Action, ObjectRef, Resource } from "../models";

const ORG_TARGET: ObjectRef = { kind: "org" };

/**
 * The single authorization gate. Evaluates `resource:action` on `target` against
 * the principal's effective policy statements with DENY-WINS, DEFAULT-DENY
 * resolution. Bypass order: platform superadmin, then org owner (root,
 * undeniable). `target` defaults to the org level. See
 * docs/specs/authz/POLICY-GROUPS-SPEC.md §7.
 */
export const assertAccess = (resource: Resource, action: Action, target?: ObjectRef) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    const token = `${resource}:${action}`;
    const path = resolvePath(target ?? ORG_TARGET);
    if (!isAllowed(ctx.effectiveStatements, token, path)) {
      return yield* new Forbidden({ message: `Insufficient permission: ${token} on ${path}` });
    }
  });

/**
 * Capability gate for object-scoped actions whose concrete target is not yet
 * known (e.g. content-addressed asset finalize, which has no project context).
 * Passes if the principal holds an `allow` for `resource:action` on ANY scope —
 * a coarse "can do this somewhere" check, NOT a per-object grant. Use sparingly,
 * only where a precise {@link assertAccess} target genuinely cannot be resolved.
 */
export const assertAccessAny = (resource: Resource, action: Action) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    const token = `${resource}:${action}`;
    const holds = ctx.effectiveStatements.some(
      (statement) => statement.effect === "allow" && actionMatches(statement.actions, token),
    );
    if (!holds) {
      return yield* new Forbidden({ message: `Insufficient permission: ${token}` });
    }
  });

// Gate for the platform admin surface: requires the global (cross-org)
// superadmin flag, not a per-org membership role or policy.
export const assertSuperadmin = Effect.gen(function* () {
  const ctx = yield* CurrentActor;
  if (!ctx.isSuperadmin) {
    return yield* new Forbidden({ message: "Superadmin access required" });
  }
});
