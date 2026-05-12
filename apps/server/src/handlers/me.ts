import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { AuthMetaRepo } from "../repositories/auth-meta";

export const MeGroupLive = HttpApiBuilder.group(ManagementApi, "me", (handlers) =>
  handlers.handle("get", () =>
    Effect.gen(function* () {
      const ctx = yield* CurrentActor;
      const repo = yield* AuthMetaRepo;
      const user = ctx.userId === null ? null : yield* repo.findUserById(ctx.userId);
      const organization = yield* repo.findOrganizationById(ctx.organizationId);
      return {
        user: user ? { id: user.id, name: user.name, email: user.email } : null,
        activeOrganization: organization
          ? {
              id: organization.id,
              name: organization.name,
              slug: organization.slug,
              role: ctx.role,
            }
          : null,
        source: ctx.source,
        actorEmail: ctx.actorEmail,
      };
    }),
  ),
);
