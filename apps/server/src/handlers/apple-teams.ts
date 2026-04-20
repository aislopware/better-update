import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { toApiAppleTeamWithCounts } from "../http/to-api";
import { toApiForbiddenEffect } from "../http/to-api-effect";
import { AppleTeamRepo } from "../repositories/apple-teams";

export const AppleTeamsGroupLive = HttpApiBuilder.group(ManagementApi, "appleTeams", (handlers) =>
  handlers.handle("list", () =>
    toApiForbiddenEffect(
      Effect.gen(function* () {
        yield* assertPermission("appleCredential", "read");
        const ctx = yield* CurrentActor;
        const repo = yield* AppleTeamRepo;
        const teams = yield* repo.listWithCounts({ organizationId: ctx.organizationId });
        return { items: teams.map(toApiAppleTeamWithCounts) };
      }),
    ),
  ),
);
