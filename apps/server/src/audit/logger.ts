import { Effect } from "effect";

import { CurrentActor } from "../auth/current-actor";
import { toDbNull } from "../lib/nullable";
import { AuditLogRepo } from "../repositories/audit-logs";

import type { AuditLogResourceType } from "../models";

export const logAudit = (params: {
  action: string;
  resourceType: AuditLogResourceType;
  resourceId?: string | undefined;
  projectId?: string | undefined;
  metadata?: Record<string, unknown>;
}) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    const repo = yield* AuditLogRepo;

    yield* repo.insert({
      id: crypto.randomUUID(),
      organizationId: ctx.organizationId,
      projectId: toDbNull(params.projectId),
      actorId: ctx.userId,
      actorEmail: ctx.actorEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: toDbNull(params.resourceId),
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      source: ctx.source,
    });
  });
