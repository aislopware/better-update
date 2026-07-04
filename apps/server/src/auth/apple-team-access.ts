// Apple-team-scoped authorization helpers for the credential handlers
// (authz-models.ts "APPLE-TEAM axis", GITLAB-RBAC-SPEC §1a/§3b). Credential
// rows store the INTERNAL `apple_teams.id`; these helpers resolve the team
// row and enforce the v2 binding gate: the required rank (base
// CREDENTIAL_RULES rank, raised to maintainer when the team is protected)
// must be held on SOME project the TEAM is bound to — an unbound team is
// admin-only. The team's protected flag AND its bindings CASCADE — child
// credentials have neither of their own. Team-less credentials (issuer-only
// ASC keys) are ALWAYS protected and bind individually (`ascApiKey` rows).

import { Effect } from "effect";

import { Forbidden } from "../errors";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { ProjectCredentialBindingRepo } from "../repositories/project-credential-bindings";
import { bindingHint } from "./binding-hint";
import { CurrentActor } from "./current-actor";
import {
  boundCredentialAllowed,
  CREDENTIAL_RULES,
  credentialRequiredRank,
  effectiveProjectRole,
  projectRoleAtLeast,
} from "./role-matrix";

import type { Action, CurrentActor as CurrentActorModel, ProjectRole } from "../models";

// Base rank for an apple-credential action (spec §2, org table). Unlisted
// actions fail closed at maintainer.
const baseRank = (action: Action): ProjectRole =>
  CREDENTIAL_RULES[`appleCredential:${action}`] ?? "maintainer";

const holdsCredentialRank = (
  ctx: CurrentActorModel,
  action: Action,
  isProtected: boolean,
  boundProjectIds: readonly string[],
): boolean =>
  ctx.isSuperadmin ||
  ctx.isOwner ||
  boundCredentialAllowed(
    ctx,
    boundProjectIds,
    credentialRequiredRank(baseRank(action), isProtected),
  );

// `binding` names the row an admin would bind (team, or the team-less ASC
// key itself); omitted when the caller has no concrete resource in hand.
const credentialDenied = (
  action: Action,
  isProtected: boolean,
  binding?: { readonly resourceType: "appleTeam" | "ascApiKey"; readonly resourceId: string },
) => {
  const requirement = isProtected
    ? "this credential is protected (requires the Maintainer role on a project it is bound to)"
    : "requires access via a project this credential is bound to";
  const hint =
    binding === undefined ? "" : `; ${bindingHint(binding.resourceType, binding.resourceId)}`;
  return new Forbidden({
    message: `Insufficient permission: appleCredential:${action} — ${requirement}${hint}`,
  });
};

// The row an admin would bind to lift the denial: the team, or (team-less)
// the ASC key itself. Undefined when neither is known.
const bindingRefOf = (params: {
  readonly appleTeamRowId: string | null;
  readonly ascApiKeyId?: string | undefined;
}):
  | { readonly resourceType: "appleTeam" | "ascApiKey"; readonly resourceId: string }
  | undefined => {
  if (params.appleTeamRowId !== null) {
    return { resourceType: "appleTeam", resourceId: params.appleTeamRowId };
  }
  if (params.ascApiKeyId !== undefined) {
    return { resourceType: "ascApiKey", resourceId: params.ascApiKeyId };
  }
  return undefined;
};

const bindingRepoBoundIds = (params: {
  readonly organizationId: string;
  readonly resourceType: "appleTeam" | "ascApiKey";
  readonly resourceId: string;
}) => ProjectCredentialBindingRepo.pipe(Effect.flatMap((repo) => repo.boundProjectIds(params)));

// Binding set of a credential row: its team's (cascade) or, for team-less
// ASC keys, its own. Team-less rows without a key id resolve to [] (unbound
// = admin-only).
const resolveBoundProjectIds = (params: {
  readonly organizationId: string;
  readonly appleTeamRowId: string | null;
  readonly ascApiKeyId: string | undefined;
}) => {
  if (params.appleTeamRowId !== null) {
    return bindingRepoBoundIds({
      organizationId: params.organizationId,
      resourceType: "appleTeam",
      resourceId: params.appleTeamRowId,
    });
  }
  if (params.ascApiKeyId === undefined) {
    return Effect.succeed<readonly string[]>([]);
  }
  return bindingRepoBoundIds({
    organizationId: params.organizationId,
    resourceType: "ascApiKey",
    resourceId: params.ascApiKeyId,
  });
};

/**
 * Whether the actor can read credentials under an Apple team, given the
 * team's protected flag and its bound project ids. `team === null` = the
 * team-less bucket (always protected; pass the ASC key's OWN binding set).
 * Pure — backs list filtering; per-object gates stay on
 * {@link assertAppleCredentialAccess}.
 */
export const canReadAppleTeamCredentials = (
  ctx: CurrentActorModel,
  team: { readonly isProtected: boolean } | null,
  boundProjectIds: readonly string[],
): boolean =>
  holdsCredentialRank(ctx, "read", team === null ? true : team.isProtected, boundProjectIds);

/**
 * Filter credential rows down to the ones the actor can read under the v2
 * binding gate. `teamRowIdOf` returns the row's INTERNAL `apple_teams.id`
 * (or `null` for team-less credentials). Teams + bindings are loaded once
 * per call; each row is evaluated against its team's protected flag and
 * bound projects. A dangling team reference hides the row (fail closed).
 * Team-less rows are admin-only UNLESS `teamlessBindingIdOf` supplies their
 * own `ascApiKey` binding id (only the ASC key handler does).
 */
export const filterByAppleTeamRead = <T>(
  items: readonly T[],
  teamRowIdOf: (item: T) => string | null,
  opts?: { readonly teamlessBindingIdOf?: (item: T) => string },
) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return items;
    }
    const teams = yield* (yield* AppleTeamRepo).listByOrg({
      organizationId: ctx.organizationId,
    });
    const bindings = yield* ProjectCredentialBindingRepo;
    const teamBindings = yield* bindings.boundProjectIdsByResource({
      organizationId: ctx.organizationId,
      resourceType: "appleTeam",
    });
    const teamlessBindingIdOf = opts?.teamlessBindingIdOf;
    const ascKeyBindings =
      teamlessBindingIdOf === undefined
        ? {}
        : yield* bindings.boundProjectIdsByResource({
            organizationId: ctx.organizationId,
            resourceType: "ascApiKey",
          });
    const protectedByRowId = new Map(teams.map((team) => [team.id, team.isProtected]));
    return items.filter((item) => {
      const rowId = teamRowIdOf(item);
      if (rowId === null) {
        // Team-less bucket: always protected, bound per ASC key row.
        const bound =
          teamlessBindingIdOf === undefined
            ? []
            : (ascKeyBindings[teamlessBindingIdOf(item)] ?? []);
        return holdsCredentialRank(ctx, "read", true, bound);
      }
      const isProtected = protectedByRowId.get(rowId);
      if (isProtected === undefined) {
        return false;
      }
      return holdsCredentialRank(ctx, "read", isProtected, teamBindings[rowId] ?? []);
    });
  });

/**
 * Per-object gate for an EXISTING credential: resolve the row's internal team
 * reference, its bindings, and enforce the (protected-aware) bound-rank
 * ladder. Owner/superadmin/org-admin skip the lookups — the gate would
 * bypass anyway. For TEAM-LESS ASC keys pass `ascApiKeyId` so their own
 * binding set applies; other team-less rows are admin-only.
 */
export const assertAppleCredentialAccess = (params: {
  readonly action: Action;
  readonly appleTeamRowId: string | null;
  readonly ascApiKeyId?: string | undefined;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return;
    }
    const isProtected =
      params.appleTeamRowId === null
        ? true
        : (yield* (yield* AppleTeamRepo).findById({ id: params.appleTeamRowId })).isProtected;
    const bound = yield* resolveBoundProjectIds({
      organizationId: ctx.organizationId,
      appleTeamRowId: params.appleTeamRowId,
      ascApiKeyId: params.ascApiKeyId,
    });
    if (!holdsCredentialRank(ctx, params.action, isProtected, bound)) {
      return yield* credentialDenied(params.action, isProtected, bindingRefOf(params));
    }
  });

/**
 * Devices ride their team's binding (spec §1a): required rank = the
 * `device:*` base (developer), raised to maintainer when the team is
 * protected, held on some project the team is bound to. Team-less devices
 * are org-admin-only (nothing to bind).
 */
export const assertDeviceAccess = (params: {
  readonly action: Action;
  readonly appleTeamRowId: string | null;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return;
    }
    if (params.appleTeamRowId === null) {
      return yield* new Forbidden({
        message: `Insufficient permission: device:${params.action} — devices without an Apple team are org-admin-only`,
      });
    }
    const deviceDenied = new Forbidden({
      message: `Insufficient permission: device:${params.action} — requires access via a project the device's Apple team is bound to; ${bindingHint("appleTeam", params.appleTeamRowId)}`,
    });
    const team = yield* (yield* AppleTeamRepo).findById({ id: params.appleTeamRowId });
    const bound = yield* bindingRepoBoundIds({
      organizationId: ctx.organizationId,
      resourceType: "appleTeam",
      resourceId: params.appleTeamRowId,
    });
    const required = credentialRequiredRank(
      CREDENTIAL_RULES[`device:${params.action}`] ?? "maintainer",
      team.isProtected,
    );
    if (!boundCredentialAllowed(ctx, bound, required)) {
      return yield* deviceDenied;
    }
  });

/**
 * Team row ids whose credentials/devices the actor may READ — `"all"` for
 * admin-tier actors, otherwise the concrete (possibly empty) id list. Backs
 * server-side list scoping (devices).
 */
export const readableAppleTeamRowIds = Effect.gen(function* () {
  const ctx = yield* CurrentActor;
  if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
    return "all" as const;
  }
  const teams = yield* (yield* AppleTeamRepo).listByOrg({
    organizationId: ctx.organizationId,
  });
  const teamBindings = yield* ProjectCredentialBindingRepo.pipe(
    Effect.flatMap((repo) =>
      repo.boundProjectIdsByResource({
        organizationId: ctx.organizationId,
        resourceType: "appleTeam",
      }),
    ),
  );
  return teams
    .filter((team) =>
      boundCredentialAllowed(
        ctx,
        teamBindings[team.id] ?? [],
        credentialRequiredRank(CREDENTIAL_RULES["device:read"] ?? "maintainer", team.isProtected),
      ),
    )
    .map((team) => team.id);
});

/**
 * Gate for creating a credential under an Apple team (10-char identifier
 * from the upload payload; absent = team-less, always protected). Runs
 * BEFORE the team row is upserted, so unauthorized uploads cannot create
 * team rows as a side effect. v2 semantics (spec §1a):
 *
 * - Existing team: the base create rank on some project the team is BOUND
 *   to (protected team ⇒ maintainer). A `projectId` outside the binding set
 *   is refused for non-admins — binding a pre-existing team to a new
 *   project is org-admin work.
 * - New team / team-less key: requires `projectId` + Maintainer there (the
 *   auto-bind path) — non-admins cannot create unbound credentials.
 *
 * Admin/owner/superadmin always pass. The handler binds AFTER the insert
 * whenever `projectId` was provided (idempotent for already-bound teams).
 */
export const assertAppleCredentialCreate = (params: {
  readonly appleTeamIdentifier: string | null | undefined;
  readonly projectId?: string | undefined;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner || ctx.orgRole === "admin") {
      return;
    }

    const requireMaintainerAutoBind = Effect.gen(function* () {
      if (
        params.projectId === undefined ||
        !projectRoleAtLeast(effectiveProjectRole(ctx, params.projectId), "maintainer")
      ) {
        return yield* new Forbidden({
          message:
            "Creating a new credential requires the Maintainer role on the target project (pass projectId) or org admin",
        });
      }
    });

    const identifier = params.appleTeamIdentifier;
    if (typeof identifier !== "string") {
      // Team-less ASC key: always protected, bound to the project it is
      // created for.
      return yield* requireMaintainerAutoBind;
    }

    const team = yield* Effect.gen(function* () {
      const repo = yield* AppleTeamRepo;
      return yield* repo.findByAppleTeamId({
        organizationId: ctx.organizationId,
        appleTeamId: identifier,
      });
    }).pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));

    if (team === null) {
      // Unknown team = about to be created by this upload ⇒ auto-bind path.
      return yield* requireMaintainerAutoBind;
    }

    const bound = yield* bindingRepoBoundIds({
      organizationId: ctx.organizationId,
      resourceType: "appleTeam",
      resourceId: team.id,
    });
    if (params.projectId !== undefined && !bound.includes(params.projectId)) {
      return yield* new Forbidden({
        message: `This Apple team is not bound to project ${params.projectId} — ${bindingHint("appleTeam", team.id, params.projectId)}`,
      });
    }
    if (!holdsCredentialRank(ctx, "create", team.isProtected, bound)) {
      return yield* credentialDenied("create", team.isProtected, {
        resourceType: "appleTeam",
        resourceId: team.id,
      });
    }
  });
