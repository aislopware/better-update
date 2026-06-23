import { Effect, Option } from "effect";

import { Forbidden } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { CurrentActor } from "./current-actor";
import { actionMatches, isAllowed, resolvePath } from "./policy-match";

import type { Action, ObjectRef, Resource } from "../models";

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

// Writes blocked while a project is archived (the GitHub "archived repo is
// read-only" model). Reads/downloads always pass; deleting the project ITSELF
// stays allowed (you can delete an archived project) — only sub-resource deletes
// and create/update/cancel are blocked. Org-scoped targets are never project
// writes.
const isBlockedWhileArchived = (action: Action, target: ObjectRef): boolean => {
  if (target.kind === "org") {
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
    const projectId = target.kind === "org" ? null : target.projectId;
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
