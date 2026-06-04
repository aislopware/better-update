import { ApiKey, CreatedApiKey } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { NotFound } from "../errors";
import { toApiForbiddenEffect, toApiReadEffect } from "../http/to-api-effect";
import { ApiKeyRepo } from "../repositories/api-keys";

import type { ApiKeyModel } from "../repositories/api-keys";

const MS_PER_DAY = 86_400_000;

const expiresAtFromDays = (days: number | undefined): string | null =>
  days === undefined ? null : new Date(Date.now() + days * MS_PER_DAY).toISOString();

const toApiKey = (model: ApiKeyModel): ApiKey =>
  new ApiKey({
    id: model.id,
    name: model.name,
    start: model.start,
    prefix: model.prefix,
    enabled: model.enabled,
    createdAt: model.createdAt,
    expiresAt: model.expiresAt,
  });

export const ApiKeysGroupLive = HttpApiBuilder.group(ManagementApi, "api-keys", (handlers) =>
  handlers
    .handle("list", () =>
      toApiForbiddenEffect(
        Effect.gen(function* () {
          yield* assertAccess("apiKey", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* ApiKeyRepo;
          const keys = yield* repo.list({ organizationId: ctx.organizationId });
          return { items: keys.map(toApiKey) };
        }),
      ),
    )
    .handle("create", ({ payload }) =>
      toApiForbiddenEffect(
        Effect.gen(function* () {
          yield* assertAccess("apiKey", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* ApiKeyRepo;
          const minted = yield* repo.mint({
            organizationId: ctx.organizationId,
            name: payload.name,
            expiresAt: expiresAtFromDays(payload.expiresInDays),
          });
          yield* logAudit({
            action: "apiKey.create",
            resourceType: "apiKey",
            resourceId: minted.model.id,
            metadata: { name: payload.name },
          });
          return new CreatedApiKey({
            id: minted.model.id,
            name: minted.model.name,
            start: minted.model.start,
            prefix: minted.model.prefix,
            enabled: minted.model.enabled,
            createdAt: minted.model.createdAt,
            expiresAt: minted.model.expiresAt,
            key: minted.key,
          });
        }),
      ),
    )
    .handle("revoke", ({ path }) =>
      toApiReadEffect(
        Effect.gen(function* () {
          yield* assertAccess("apiKey", "delete");
          const ctx = yield* CurrentActor;
          const repo = yield* ApiKeyRepo;
          const deleted = yield* repo.revoke({ id: path.id, organizationId: ctx.organizationId });
          if (!deleted) {
            return yield* new NotFound({ message: "API key not found" });
          }
          yield* logAudit({
            action: "apiKey.delete",
            resourceType: "apiKey",
            resourceId: path.id,
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
