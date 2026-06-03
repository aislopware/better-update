import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { ChannelGrant as ChannelGrantSchema } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { statement } from "../auth/access-control";
import { CurrentActor } from "../auth/current-actor";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { Forbidden, NotFound } from "../errors";
import { toApiReadEffect } from "../http/to-api-effect";
import { ChannelRepo } from "../repositories/channels";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";
import { MemberRepo } from "../repositories/org-role-repo";

import type { EnvironmentGrantModel } from "../authz-models";

// Valid resource names a grant action token may reference (the AccessControl
// statement is the full grantable menu). Cached at module scope — `statement`
// is a static derivation of `permissions.ts`.
const VALID_RESOURCES = new Set(Object.keys(statement));

const ACTION_TOKEN = /^[a-z]+:[a-z]+$/iu;

const SCOPE_KIND = "channel" as const;

const toApiChannelGrant = (grant: EnvironmentGrantModel): typeof ChannelGrantSchema.Type => ({
  id: grant.id,
  memberId: grant.memberId,
  // The `ChannelGrant` schema fixes `scopeKind` to the literal "channel". Every
  // grant this handler reads/writes uses `SCOPE_KIND`, so the model's widened
  // `ScopeKind` field is always that literal here — emit the constant directly to
  // satisfy the narrowed schema type without an assertion (mirrors env-grants).
  scopeKind: SCOPE_KIND,
  scopeId: grant.scopeId,
  effect: grant.effect,
  actions: [...grant.actions],
  createdAt: grant.createdAt,
});

// Every token must be a `resource:action` pair whose resource is a real,
// grantable AccessControl resource. Rejects free-form strings before they reach
// the grant store (a stored garbage token could never match a real check, but
// rejecting early keeps the grant set meaningful + auditable). Surfaced as
// Forbidden — the endpoint's declared error set is { NotFound, Forbidden } and a
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
      yield* new Forbidden({
        message: `Invalid grant action(s): ${invalid.join(", ")}. Expected "resource:action" with a known resource.`,
      });
    }
  });

// Resolve + tenant-scope the channel, then gate. Managing who can act on a
// channel is a membership-admin action, so it requires `member:update` —
// owner/admin only (developer/viewer lack it). Returns the channel for audit.
const resolveAndGateChannel = (channelId: string) =>
  Effect.gen(function* () {
    const channelRepo = yield* ChannelRepo;
    const channel = yield* channelRepo.findById({ id: channelId });
    yield* assertProjectOwnership(channel.projectId);
    yield* assertPermission("member", "update");
    return channel;
  });

export const ChannelGrantsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "channelGrants",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            yield* resolveAndGateChannel(path.id);
            const grantRepo = yield* EnvironmentGrantRepo;
            const grants = yield* grantRepo.findByScope({
              scopeKind: SCOPE_KIND,
              scopeId: path.id,
            });
            return grants.map(toApiChannelGrant);
          }),
        ),
      )
      .handle("upsert", ({ path, payload }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            const channel = yield* resolveAndGateChannel(path.id);
            const ctx = yield* CurrentActor;

            // The grant target must be a member of the acting org (anti-
            // enumeration + FK integrity). NotFound for a non-member or cross-org
            // member id.
            const memberRepo = yield* MemberRepo;
            const memberOrgId = yield* memberRepo.findOrgId({ memberId: path.memberId });
            if (memberOrgId !== ctx.organizationId) {
              return yield* new NotFound({ message: "Member not found" });
            }

            yield* assertValidActionTokens(payload.actions);

            const grantRepo = yield* EnvironmentGrantRepo;
            const grant = yield* grantRepo.upsert({
              organizationId: ctx.organizationId,
              memberId: path.memberId,
              scopeKind: SCOPE_KIND,
              scopeId: path.id,
              effect: payload.effect,
              actions: payload.actions,
            });

            yield* logAudit({
              action: "channel.grant.set",
              resourceType: "channel",
              resourceId: path.id,
              projectId: channel.projectId,
              metadata: {
                memberId: path.memberId,
                effect: payload.effect,
                actions: [...payload.actions],
              },
            });

            return toApiChannelGrant(grant);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiReadEffect(
          Effect.gen(function* () {
            const channel = yield* resolveAndGateChannel(path.id);
            const grantRepo = yield* EnvironmentGrantRepo;
            yield* grantRepo.deleteForMemberOnScope({
              memberId: path.memberId,
              scopeKind: SCOPE_KIND,
              scopeId: path.id,
            });

            yield* logAudit({
              action: "channel.grant.revoke",
              resourceType: "channel",
              resourceId: path.id,
              projectId: channel.projectId,
              metadata: { memberId: path.memberId },
            });

            return { deleted: 1 };
          }),
        ),
      ),
);
