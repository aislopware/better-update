import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { canReadAppleTeamCredentials } from "../auth/apple-team-access";
import { CurrentActor } from "../auth/current-actor";
import { assertAccessAny } from "../auth/policy";
import { toApiAppleTeamWithCounts } from "../http/to-api";
import { toApiForbiddenEffect } from "../http/to-api-effect";
import { AppleTeamRepo } from "../repositories/apple-teams";

export const AppleTeamsGroupLive = HttpApiBuilder.group(ManagementApi, "appleTeams", (handlers) =>
  handlers.handle("list", () =>
    toApiForbiddenEffect(
      Effect.gen(function* () {
        // Coarse gate (403 for zero-access actors), then per-team filtering:
        // a team-scoped policy sees exactly its teams (authz-models.ts
        // "APPLE-TEAM axis").
        yield* assertAccessAny("appleCredential", "read");
        const ctx = yield* CurrentActor;
        const repo = yield* AppleTeamRepo;
        const teams = yield* repo.listWithCounts({ organizationId: ctx.organizationId });
        const visible = teams.filter((team) => canReadAppleTeamCredentials(ctx, team.appleTeamId));
        return { items: visible.map(toApiAppleTeamWithCounts) };
      }),
    ),
  ),
);
