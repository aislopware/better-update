import { compact } from "@better-update/type-guards";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertVaultRotationNotPending } from "../application/assert-vault-rotation";
import { assertVaultVersionCurrent } from "../application/assert-vault-version";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { BadRequest } from "../errors";
import { toApiEnvVar } from "../http/to-api";
import {
  toApiBadRequestReadEffect,
  toApiResolveReadEffect,
  toApiWriteEffect,
} from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { EnvVarRepo } from "../repositories/env-vars";
import {
  applyOverrideResolution,
  assertEnvironmentExists,
  assertEnvVarCountWithinCap,
  assertEnvVarScopedPermission,
  assertScopeOwnership,
  handleBulkImport,
  handleExport,
  parseEnvironmentsCsv,
  resolveEnvReadPredicate,
  resolveListScope,
  validateKey,
} from "./env-vars-helpers";

import type { EnvVarListFilters, EnvVarRevisionInput } from "../repositories/env-vars";

/** Reshape the wire envelope (`ciphertext`) into the repo's revision input (`valueCiphertext`). */
const toRevision = (value: {
  readonly id: string;
  readonly ciphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}): EnvVarRevisionInput => ({
  id: value.id,
  valueCiphertext: value.ciphertext,
  wrappedDek: value.wrappedDek,
  vaultVersion: value.vaultVersion,
});

export const EnvVarsGroupLive = HttpApiBuilder.group(ManagementApi, "env-vars", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          const ctx = yield* CurrentActor;

          const { scope, projectId } = payload;
          yield* assertScopeOwnership(scope, projectId);
          yield* assertEnvVarScopedPermission(
            "create",
            scope === "project" ? toDbNull(projectId) : null,
            payload.environment,
          );
          yield* validateKey(payload.key);
          yield* assertEnvironmentExists(ctx.organizationId, payload.environment);
          yield* assertVaultVersionCurrent({
            organizationId: ctx.organizationId,
            vaultVersion: payload.value.vaultVersion,
          });

          yield* assertEnvVarCountWithinCap(scope, projectId, ctx.organizationId);

          const repo = yield* EnvVarRepo;
          const model = yield* repo.insertWithRevision({
            organizationId: ctx.organizationId,
            projectId: scope === "project" ? toDbNull(projectId) : null,
            scope,
            environment: payload.environment,
            key: payload.key,
            visibility: payload.visibility,
            createdByUserId: ctx.userId,
            revision: toRevision(payload.value),
          });

          yield* logAudit({
            action: "envVar.create",
            resourceType: "envVar",
            resourceId: model.id,
            ...(scope === "project" && projectId ? { projectId } : {}),
            metadata: {
              key: payload.key,
              scope,
              environment: payload.environment,
              visibility: payload.visibility,
            },
          });

          return toApiEnvVar(model);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const ctx = yield* CurrentActor;

          const scope = resolveListScope(urlParams);
          const { projectId } = urlParams;

          if (scope === "project" || (scope === "all" && projectId)) {
            if (!projectId) {
              return yield* new BadRequest({
                message: "projectId is required when scope is 'project' or 'all'",
              });
            }
            yield* assertProjectOwnership(projectId);
          } else {
            yield* assertOrgOwnership(ctx.organizationId);
          }

          const environments = yield* parseEnvironmentsCsv(urlParams.environments);

          const repo = yield* EnvVarRepo;
          const { limit, offset } = parsePagination(urlParams, 50);

          const filters: EnvVarListFilters = {
            organizationId: ctx.organizationId,
            ...(projectId ? { projectId } : {}),
            scope,
            ...(environments ? { environments } : {}),
            ...(urlParams.search ? { search: urlParams.search } : {}),
            limit,
            offset,
          };

          const isReadable = yield* resolveEnvReadPredicate();

          const { items } = yield* repo.list(filters);
          const readable = items.filter((model) => isReadable(model.projectId, model.environment));

          if (scope === "all") {
            const resolved = applyOverrideResolution(readable);
            return {
              items: resolved.map((entry) => toApiEnvVar(entry.model, entry.overridesGlobal)),
            };
          }
          return { items: readable.map((model) => toApiEnvVar(model)) };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

          yield* assertEnvVarScopedPermission("read", model.projectId, model.environment);

          return toApiEnvVar(model);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          const ctx = yield* CurrentActor;

          const repo = yield* EnvVarRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);

          yield* assertEnvVarScopedPermission("update", existing.projectId, existing.environment);

          if (payload.value) {
            yield* assertVaultVersionCurrent({
              organizationId: existing.organizationId,
              vaultVersion: payload.value.vaultVersion,
            });
            const model = yield* repo.addRevision({
              id: path.id,
              createdByUserId: ctx.userId,
              revision: toRevision(payload.value),
              ...compact({ visibility: payload.visibility }),
            });
            yield* logAudit({
              action: "envVar.update",
              resourceType: "envVar",
              resourceId: path.id,
              ...(existing.projectId ? { projectId: existing.projectId } : {}),
              metadata: compact({
                key: existing.key,
                revisionNumber: model.revisionNumber,
                visibility: payload.visibility,
              }),
            });
            return toApiEnvVar(model);
          }

          if (payload.visibility !== undefined) {
            const model = yield* repo.updateVisibility({
              id: path.id,
              visibility: payload.visibility,
            });
            yield* logAudit({
              action: "envVar.update",
              resourceType: "envVar",
              resourceId: path.id,
              ...(existing.projectId ? { projectId: existing.projectId } : {}),
              metadata: { key: existing.key, visibility: payload.visibility },
            });
            return toApiEnvVar(model);
          }

          return yield* new BadRequest({
            message: "Provide a new value or a visibility tier to update",
          });
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

          yield* assertEnvVarScopedPermission("delete", model.projectId, model.environment);

          yield* repo.deleteById({ id: path.id });

          yield* logAudit({
            action: "envVar.delete",
            resourceType: "envVar",
            resourceId: path.id,
            ...(model.projectId ? { projectId: model.projectId } : {}),
            metadata: { key: model.key, environment: model.environment },
          });

          return { id: path.id };
        }),
      ),
    )
    .handle("revisions", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

          yield* assertEnvVarScopedPermission("read", model.projectId, model.environment);

          const revisions = yield* repo.listRevisions({ envVarId: path.id });
          return {
            items: revisions.map((revision) => ({
              id: revision.id,
              revisionNumber: revision.revisionNumber,
              vaultVersion: revision.vaultVersion,
              isCurrent: revision.id === model.currentRevisionId,
              createdBy: revision.createdByUserId,
              createdAt: revision.createdAt,
            })),
          };
        }),
      ),
    )
    .handle("rollback", ({ path, payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const repo = yield* EnvVarRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);

          yield* assertEnvVarScopedPermission("update", existing.projectId, existing.environment);

          const model = yield* repo.rollback({ id: path.id, toRevisionId: payload.toRevisionId });

          yield* logAudit({
            action: "envVar.rollback",
            resourceType: "envVar",
            resourceId: path.id,
            ...(existing.projectId ? { projectId: existing.projectId } : {}),
            metadata: { key: existing.key, toRevisionId: payload.toRevisionId },
          });

          return toApiEnvVar(model);
        }),
      ),
    )
    .handle("bulkImport", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          const { created, updated, skipped } = yield* handleBulkImport(payload);

          yield* logAudit({
            action: "envVar.bulkImport",
            resourceType: "envVar",
            ...(payload.scope === "project" && payload.projectId
              ? { projectId: payload.projectId }
              : {}),
            metadata: {
              scope: payload.scope,
              ...(payload.projectId ? { projectId: payload.projectId } : {}),
              entries: payload.entries.length,
              created,
              updated,
            },
          });

          return { created, updated, skipped };
        }),
      ),
    )
    .handle("export", ({ urlParams }) =>
      toApiResolveReadEffect(
        Effect.gen(function* () {
          const ctx = yield* CurrentActor;
          // Fail closed while the vault is flagged for rotation (a recipient was
          // removed) — env-var values share the org vault. See assert-vault-rotation.
          yield* assertVaultRotationNotPending({ organizationId: ctx.organizationId });
          return yield* handleExport(urlParams);
        }),
      ),
    ),
);
