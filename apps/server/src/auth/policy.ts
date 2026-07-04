import { Effect, Option } from "effect";

import { GLOBAL_ENV_VAR_PROJECT_ID } from "../authz-models";
import { Forbidden } from "../errors";
import { ProjectRepo } from "../repositories/projects";
import { ProtectedEnvironmentRepo } from "../repositories/protected-environments";
import { CurrentActor } from "./current-actor";
import {
  CREDENTIAL_RULES,
  effectiveProjectRole,
  meetsAnywhereRequirement,
  meetsOrgRequirement,
  ORG_RULES,
  orgGlobalEnvVarRequirement,
  PROJECT_RULES,
  projectRoleAtLeast,
} from "./role-matrix";

import type { Action, CurrentActor as CurrentActorModel, ObjectRef, Resource } from "../models";
import type { RoleContext } from "./role-matrix";

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

/**
 * Resolve an {@link ObjectRef} to its canonical path string — used for error
 * messages and audit context only (the matrix keys off `projectId` /
 * `environment` directly). Total.
 */
export const resolvePath = (ref: ObjectRef): string => {
  switch (ref.kind) {
    case "org": {
      return "org";
    }
    case "appleCredential": {
      const base = `appleTeam/${ref.appleTeamId}/credential`;
      return ref.credentialId === undefined ? base : `${base}/${ref.credentialId}`;
    }
    case "project": {
      return `project/${ref.projectId}`;
    }
    case "build": {
      return ref.buildId === undefined
        ? `project/${ref.projectId}/build`
        : `project/${ref.projectId}/build/${ref.buildId}`;
    }
    case "credential": {
      return ref.credentialId === undefined
        ? `project/${ref.projectId}/credential`
        : `project/${ref.projectId}/credential/${ref.credentialId}`;
    }
    case "submission": {
      return ref.submissionId === undefined
        ? `project/${ref.projectId}/submission`
        : `project/${ref.projectId}/submission/${ref.submissionId}`;
    }
    case "environment": {
      return `project/${ref.projectId}/env/${ref.environment}`;
    }
    case "envVar": {
      return ref.key === undefined
        ? `project/${ref.projectId}/env/${ref.environment}/envVar`
        : `project/${ref.projectId}/env/${ref.environment}/envVar/${ref.key}`;
    }
    case "channel": {
      return `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
    }
    case "update": {
      const base = `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
      return ref.updateId === undefined ? `${base}/update` : `${base}/update/${ref.updateId}`;
    }
    case "rollout": {
      const base = `project/${ref.projectId}/env/${ref.environment}/channel/${ref.channelId}`;
      return ref.rolloutId === undefined ? `${base}/rollout` : `${base}/rollout/${ref.rolloutId}`;
    }
    default: {
      // Exhaustiveness: a newly added kind without a case above fails to
      // type-check instead of silently falling through to the org path.
      return ref satisfies never;
    }
  }
};

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

// -- Protected-environment guard (GITLAB-RBAC-SPEC §3a) -----------------------
// GitLab-protected-branches analogue: a WRITE into a protected environment
// additionally requires MAINTAINER on the target's project. Allow-conjunction
// (checked after the base matrix allow), so a developer keeps every
// non-protected write while production stays maintainer-only.

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
    if (!projectRoleAtLeast(effectiveProjectRole(ctx, envTarget.projectId), "maintainer")) {
      return yield* new Forbidden({
        message: `Environment "${envTarget.environment}" is protected — writing requires the Maintainer role on this project`,
      });
    }
  });

// -- Matrix evaluation ---------------------------------------------------------

const denied = (token: string, path: string) =>
  new Forbidden({ message: `Insufficient permission: ${token} on ${path}` });

/**
 * Pure matrix decision (no owner/superadmin bypass — the caller applies it):
 * org-scoped tokens use the org ladder; project-scoped tokens use the
 * effective project role; org-GLOBAL env vars get their special ladder
 * (spec §2). Credential/device tokens are NOT decided here — their gate needs
 * the binding set (spec §1a, v2) and lives in the credential access helpers.
 * Tokens absent from every table are denied.
 */
export const matrixAllows = (
  ctx: RoleContext,
  resource: Resource,
  action: Action,
  target: ObjectRef,
): boolean => {
  const token = `${resource}:${action}` as const;
  const projectId = projectIdOf(target);

  if (projectId === null) {
    const orgRequirement = ORG_RULES[token];
    return orgRequirement !== undefined && meetsOrgRequirement(ctx.orgRole, orgRequirement);
  }

  // Org-GLOBAL env vars: reads at developer-anywhere, writes are org admin.
  if (target.kind === "envVar" && projectId === GLOBAL_ENV_VAR_PROJECT_ID) {
    const requirement = orgGlobalEnvVarRequirement(action);
    return requirement === "anywhere-read"
      ? meetsAnywhereRequirement(ctx, "developer")
      : meetsOrgRequirement(ctx.orgRole, requirement);
  }

  const minRole = PROJECT_RULES[token];
  if (minRole !== undefined) {
    return projectRoleAtLeast(effectiveProjectRole(ctx, projectId), minRole);
  }
  // Org-rule fallback for tokens like `project:delete` whose call sites carry
  // a project target.
  const orgRequirement = ORG_RULES[token];
  return orgRequirement !== undefined && meetsOrgRequirement(ctx.orgRole, orgRequirement);
};

/**
 * The single authorization gate (GITLAB-RBAC-SPEC §4b). Evaluates
 * `resource:action` on `target` against the static role matrix: org-scoped
 * tokens use the org ladder (or the anywhere-rank for org-shared build
 * inputs), project-scoped tokens use the principal's effective role on the
 * target's project. Bypass order: platform superadmin, then org owner (root,
 * undeniable). `target` defaults to the org level. Tokens absent from the
 * matrix are denied for everyone below owner (default-deny).
 *
 * Project-scoped WRITES additionally pass through the archived read-only guard
 * (before any role bypass) — an archived project rejects mutations with 403 until
 * unarchived. Pass `{ allowArchived: true }` from the unarchive/archive endpoints.
 *
 * Writes whose target carries an `environment` additionally pass the
 * protected-environment guard (after the base allow): a protected environment
 * requires Maintainer on the project (spec §3a).
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
    if (!matrixAllows(ctx, resource, action, objectTarget)) {
      return yield* denied(`${resource}:${action}`, resolvePath(objectTarget));
    }
    yield* assertProtectedEnvironmentWritable(ctx, action, objectTarget);
  });

/**
 * Capability gate for actions whose concrete target is not yet known (e.g.
 * content-addressed asset finalize, credential list endpoints). Passes if the
 * principal could perform `resource:action` SOMEWHERE — i.e. their
 * anywhere-rank meets the token's credential/project rule — a coarse "can do
 * this somewhere" PRE-gate, NOT a per-object grant: credential rows are
 * additionally filtered/gated by their project bindings (spec §1a, v2). Use
 * sparingly, only where a precise {@link assertAccess} target genuinely
 * cannot be resolved.
 */
export const assertAccessAny = (resource: Resource, action: Action) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    const token = `${resource}:${action}` as const;
    const minRole = CREDENTIAL_RULES[token] ?? PROJECT_RULES[token];
    if (minRole !== undefined && meetsAnywhereRequirement(ctx, minRole)) {
      return;
    }
    const orgRequirement = ORG_RULES[token];
    if (orgRequirement !== undefined && meetsOrgRequirement(ctx.orgRole, orgRequirement)) {
      return;
    }
    return yield* new Forbidden({ message: `Insufficient permission: ${token}` });
  });

// Gate for org administration without a dedicated matrix token (the
// protected-resource toggles): owner/superadmin bypass, org admin passes.
export const assertOrgAdmin = Effect.gen(function* () {
  const ctx = yield* CurrentActor;
  if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
    return;
  }
  return yield* new Forbidden({ message: "Org admin access required" });
});

// Gate for the platform admin surface: requires the global (cross-org)
// superadmin flag, not a per-org membership role.
export const assertSuperadmin = Effect.gen(function* () {
  const ctx = yield* CurrentActor;
  if (!ctx.isSuperadmin) {
    return yield* new Forbidden({ message: "Superadmin access required" });
  }
});
