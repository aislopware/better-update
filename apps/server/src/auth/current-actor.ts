import { Effect, pipe } from "effect";

import { AuthContext } from "./context";

import type { CurrentActor as CurrentActorModel } from "../models";

export const CurrentActor = pipe(
  AuthContext,
  Effect.map(
    (ctx): CurrentActorModel => ({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: ctx.role,
      effectivePermissions: ctx.effectivePermissions,
      source: ctx.source,
      actorEmail: ctx.actorEmail,
    }),
  ),
);
