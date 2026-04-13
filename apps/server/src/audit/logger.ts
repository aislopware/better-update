import { AuthContext } from "@better-update/api";
import { Either, Effect } from "effect";

import { AuditLogRepo } from "../repositories/audit-logs";

export const logAudit = (params: {
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}) =>
  Effect.gen(function* () {
    const ctx = yield* AuthContext;
    const repo = yield* AuditLogRepo;

    yield* repo.insert({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      source: ctx.source,
    });
  }).pipe(
    Effect.either,
    Effect.flatMap((result) =>
      Either.isRight(result)
        ? Effect.void
        : Effect.logWarning("Audit log insert failed", result.left),
    ),
  );
