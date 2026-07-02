// Apple-team-scoped authorization helpers for the credential handlers
// (authz-models.ts "APPLE-TEAM axis"). Credential rows store the INTERNAL
// `apple_teams.id`, while policy paths use the 10-char Apple Team identifier —
// these helpers own that translation so handlers never build paths by hand.

import { Effect } from "effect";

import { APPLE_TEAMLESS_SEGMENT } from "../authz-models";
import { AppleTeamRepo } from "../repositories/apple-teams";
import { CurrentActor } from "./current-actor";
import { assertAccess } from "./policy";
import { isAllowed, resolvePath } from "./policy-match";

import type { Action, CurrentActor as CurrentActorModel } from "../models";

const credentialCollectionPath = (appleTeamId: string | null): string =>
  resolvePath({ kind: "appleCredential", appleTeamId: appleTeamId ?? APPLE_TEAMLESS_SEGMENT });

/**
 * Whether the actor can read credentials under an Apple team (10-char
 * identifier, `null` = team-less). Evaluated at the credential COLLECTION path
 * `appleTeam/{T}/credential`, so both `appleTeam/{T}` and
 * `appleTeam/{T}/credential` selectors qualify. Backs list filtering — the
 * per-object gates stay on `assertAccess`. Caveat (same as the project axis): a
 * selector scoped to one specific credential id does not surface its team in
 * lists.
 */
export const canReadAppleTeamCredentials = (
  ctx: CurrentActorModel,
  appleTeamId: string | null,
): boolean =>
  ctx.isSuperadmin ||
  ctx.isOwner ||
  isAllowed(ctx.effectiveStatements, "appleCredential:read", credentialCollectionPath(appleTeamId));

/**
 * Filter credential rows down to the ones the actor can read.
 * `teamRowIdOf` returns the row's INTERNAL `apple_teams.id` (or `null` for
 * team-less credentials); `credentialIdOf` returns the row's own id. The org's
 * teams are loaded once to translate to the 10-char identifiers policies are
 * written against, then each row is evaluated at its FULL object path
 * `appleTeam/{T}/credential/{id}` — so a team-wide allow covers it by prefix, an
 * item-level allow surfaces it, and an item-level deny hides it (deny-wins),
 * staying symmetric with the by-id gate. A dangling team reference hides the row
 * (fail closed) rather than treating it as team-less.
 */
export const filterByAppleTeamRead = <T>(
  items: readonly T[],
  teamRowIdOf: (item: T) => string | null,
  credentialIdOf: (item: T) => string,
) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return items;
    }
    const teams = yield* (yield* AppleTeamRepo).listByOrg({
      organizationId: ctx.organizationId,
    });
    const appleIdByRowId = new Map(teams.map((team) => [team.id, team.appleTeamId]));
    return items.filter((item) => {
      const rowId = teamRowIdOf(item);
      const appleTeamId = rowId === null ? APPLE_TEAMLESS_SEGMENT : appleIdByRowId.get(rowId);
      if (appleTeamId === undefined) {
        return false;
      }
      return isAllowed(
        ctx.effectiveStatements,
        "appleCredential:read",
        resolvePath({ kind: "appleCredential", appleTeamId, credentialId: credentialIdOf(item) }),
      );
    });
  });

/**
 * Per-object gate for an EXISTING credential: resolve the row's internal team
 * reference to the 10-char identifier, then `assertAccess` at
 * `appleTeam/{T}/credential/{id}`. Owner/superadmin skip the team lookup — the
 * gate would bypass anyway and Apple-team targets never hit the archived or
 * protected-environment guards.
 */
export const assertAppleCredentialAccess = (params: {
  readonly action: Action;
  readonly credentialId: string;
  readonly appleTeamRowId: string | null;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isSuperadmin || ctx.isOwner) {
      return;
    }
    const appleTeamId =
      params.appleTeamRowId === null
        ? APPLE_TEAMLESS_SEGMENT
        : (yield* (yield* AppleTeamRepo).findById({ id: params.appleTeamRowId })).appleTeamId;
    yield* assertAccess("appleCredential", params.action, {
      kind: "appleCredential",
      appleTeamId,
      credentialId: params.credentialId,
    });
  });

/**
 * Gate for creating a credential under an Apple team (10-char identifier from
 * the upload payload; absent = team-less). Runs BEFORE the team row is
 * upserted, so unauthorized uploads cannot create team rows as a side effect.
 */
export const assertAppleCredentialCreate = (appleTeamIdentifier: string | null | undefined) =>
  assertAccess("appleCredential", "create", {
    kind: "appleCredential",
    appleTeamId: appleTeamIdentifier ?? APPLE_TEAMLESS_SEGMENT,
  });
