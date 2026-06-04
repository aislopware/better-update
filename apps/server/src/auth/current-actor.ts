import { Effect, pipe } from "effect";

import { AuthContext } from "./context";

import type { CurrentActor as CurrentActorModel } from "../models";

export const CurrentActor = pipe(
  AuthContext,
  Effect.map(
    (ctx): CurrentActorModel => ({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      memberId: ctx.memberId,
      role: ctx.role,
      isOwner: ctx.isOwner,
      effectiveStatements: ctx.effectiveStatements,
      source: ctx.source,
      transport: ctx.transport,
      actorEmail: ctx.actorEmail,
      isSuperadmin: ctx.isSuperadmin,
    }),
  ),
);
