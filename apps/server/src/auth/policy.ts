import { Effect, Option } from "effect";

import { Forbidden } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { ProtectedEnvironmentRepo } from "../repositories/protected-environments";
import { CurrentActor } from "./current-actor";
import { actionMatches, isAllowed, resolvePath, selectorMatches } from "./policy-match";

import type { Action, CurrentActor as CurrentActorModel, ObjectRef, Resource } from "../models";

const ORG_TARGET: ObjectRef = { kind: "org" };

/** Options for {@link assertAccess}. */
export interface AssertAccessOptions {
  /**
   * Skip the archived-project read-only guard. ONLY the archive-state endpoints
   * (`unarchive`, and `archive` for idempotency) set this — every other write
   * must stay blocked while the project is archived.
   */
  readonly allowArchived?: boolean;
}

// Project id of a target, when it has one. Org- and Apple-team-scoped targets
// are not project writes, so the archived guard skips them.
const projectIdOf = (target: ObjectRef): string | null =>
  "projectId" in target ? target.projectId : null;

// Writes blocked while a project is archived (the GitHub "archived repo is
// read-only" model). Reads/downloads always pass; deleting the project ITSELF
// stays allowed (you can delete an archived project) — only sub-resource deletes
// and create/update/cancel are blocked. Org-scoped targets are never project
// writes.
const isBlockedWhileArchived = (action: Action, target: ObjectRef): boolean => {
  if (projectIdOf(target) === null) {
    return false;
  }
  if (action === "read" || action === "download") {
    return false;
  }
  if (action === "delete" && target.kind === "project") {
    return false;
  }
  return true;
};

// The archived read-only guard. Enforced wherever `ProjectRepo` is wired — i.e.
// every HTTP handler, which runs in the full app layer. `serviceOption` makes it
// silently skip in pure policy unit tests that provide only the actor (those
// paths are covered by handler + e2e tests). Runs for everyone, owners included:
// an archived project is read-only until explicitly unarchived.
const assertProjectWritable = (
  action: Action,
  target: ObjectRef,
  opts: AssertAccessOptions | undefined,
) =>
  Effect.gen(function* () {
    if (opts?.allowArchived || !isBlockedWhileArchived(action, target)) {
      return;
    }
    const projectId = projectIdOf(target);
    if (projectId === null) {
      return;
    }
    const repo = yield* Effect.serviceOption(ProjectRepo);
    if (Option.isNone(repo)) {
      return;
    }
    const archivedAt = yield* repo.value.findArchivedAt({ id: projectId });
    if (archivedAt !== null) {
      return yield* new Forbidden({
        message: "This project is archived and read-only. Unarchive it to make changes.",
      });
    }
  });

// -- Protected-environment guard (ROLES-CAPABILITIES-SPEC §2d) ---------------
// GitLab-protected-branches analogue: a WRITE into a protected environment
// additionally requires `environment:update` on `project/{id}/env/{E}`.
// Compiled project roles differ exactly there — maintainer holds the token at
// its project root, developer does not — and a custom policy can grant a
// targeted override (e.g. `environment:update` on `project/*/env/production`).
// Allow-conjunction (never a deny statement), so grants keep composing:
// `developer@*` + `maintainer@A` still writes A's production.

const isWriteAction = (action: Action): boolean => action !== "read" && action !== "download";

const environmentOf = (
  target: ObjectRef,
): { readonly projectId: string; readonly environment: string } | null =>
  target.kind === "environment" ||
  target.kind === "envVar" ||
  target.kind === "channel" ||
  target.kind === "update" ||
  target.kind === "rollout"
    ? { projectId: target.projectId, environment: target.environment }
    : null;

// Enforced wherever `ProtectedEnvironmentRepo` is wired (every HTTP handler);
// `serviceOption` skips it in pure policy unit tests that provide only the
// actor — those cover the guard by providing a stub repo explicitly.
const assertProtectedEnvironmentWritable = (
  ctx: CurrentActorModel,
  action: Action,
  target: ObjectRef,
) =>
  Effect.gen(function* () {
    const envTarget = environmentOf(target);
    if (envTarget === null || !isWriteAction(action)) {
      return;
    }
    const repo = yield* Effect.serviceOption(ProtectedEnvironmentRepo);
    if (Option.isNone(repo)) {
      return;
    }
    const protectedSet = yield* repo.value.listByOrg({ organizationId: ctx.organizationId });
    if (!protectedSet.has(envTarget.environment)) {
      return;
    }
    const guardPath = `project/${envTarget.projectId}/env/${envTarget.environment}`;
    if (!isAllowed(ctx.effectiveStatements, "environment:update", guardPath)) {
      return yield* new Forbidden({
        message: `Environment "${envTarget.environment}" is protected — writing requires environment:update on it (Maintainer role or an explicit grant)`,
      });
    }
  });

/**
 * The single authorization gate. Evaluates `resource:action` on `target` against
 * the principal's effective policy statements with DENY-WINS, DEFAULT-DENY
 * resolution. Bypass order: platform superadmin, then org owner (root,
 * undeniable). `target` defaults to the org level. See
 * docs/specs/authz/POLICY-GROUPS-SPEC.md §7.
 *
 * Project-scoped WRITES additionally pass through the archived read-only guard
 * (before any role bypass) — an archived project rejects mutations with 403 until
 * unarchived. Pass `{ allowArchived: true }` from the unarchive/archive endpoints.
 *
 * Writes whose target carries an `environment` additionally pass the
 * protected-environment guard (after the base allow): a protected environment
 * requires `environment:update` on `project/{id}/env/{E}`.
 */
export const assertAccess = (
  resource: Resource,
  action: Action,
  target?: ObjectRef,
  opts?: AssertAccessOptions,
) =>
  Effect.gen(function* () {
    const objectTarget = target ?? ORG_TARGET;
    yield* assertProjectWritable(action, objectTarget, opts);
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    const token = `${resource}:${action}`;
    const path = resolvePath(objectTarget);
    if (!isAllowed(ctx.effectiveStatements, token, path)) {
      return yield* new Forbidden({ message: `Insufficient permission: ${token} on ${path}` });
    }
    yield* assertProtectedEnvironmentWritable(ctx, action, objectTarget);
  });

/**
 * Capability gate for object-scoped actions whose concrete target is not yet
 * known (e.g. content-addressed asset finalize, which has no project context).
 * Passes if the principal holds an `allow` for `resource:action` on ANY scope
 * that is not fully overridden by a matching `deny` — a coarse "can do this
 * somewhere" check, NOT a per-object grant. Deny-aware so it upholds the
 * deny-wins invariant every other gate enforces: a net-zero `allow *` + `deny *`
 * does NOT pass. Use sparingly, only where a precise {@link assertAccess} target
 * genuinely cannot be resolved.
 */
export const assertAccessAny = (resource: Resource, action: Action) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    const token = `${resource}:${action}`;
    const allowSelectors = ctx.effectiveStatements
      .filter(
        (statement) => statement.effect === "allow" && actionMatches(statement.actions, token),
      )
      .flatMap((statement) => statement.resources);
    const denyStatements = ctx.effectiveStatements.filter(
      (statement) => statement.effect === "deny" && actionMatches(statement.actions, token),
    );
    // Holds if some allow selector survives every matching deny — i.e. no deny
    // selector covers that whole allow scope, so at least one path stays allowed.
    const holds = allowSelectors.some(
      (allowSelector) =>
        !denyStatements.some((deny) =>
          deny.resources.some((denySelector) => selectorMatches(denySelector, allowSelector)),
        ),
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
