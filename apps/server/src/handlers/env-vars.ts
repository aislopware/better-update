import { compact } from "@better-update/type-guards";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertVaultVersionCurrent } from "../application/assert-vault-version";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BadRequest } from "../errors";
import { toApiEnvVar } from "../http/to-api";
import { toApiBadRequestReadEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { EnvVarRepo } from "../repositories/env-vars";
import {
  MAX_VARS_PER_ORG_GLOBAL,
  MAX_VARS_PER_PROJECT,
  applyOverrideResolution,
  assertScopeOwnership,
  handleBulkImport,
  handleExport,
  parseEnvironmentsCsv,
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
          yield* assertPermission("envVar", "create");
          const ctx = yield* CurrentActor;

          const { scope, projectId } = payload;
          yield* assertScopeOwnership(scope, projectId);
          yield* validateKey(payload.key);
          yield* assertVaultVersionCurrent({
            organizationId: ctx.organizationId,
            vaultVersion: payload.value.vaultVersion,
          });

          const repo = yield* EnvVarRepo;

          if (scope === "project" && projectId) {
            const count = yield* repo.countByProject({ projectId });
            if (count >= MAX_VARS_PER_PROJECT) {
              return yield* new BadRequest({
                message: `Maximum of ${MAX_VARS_PER_PROJECT} variables per project reached`,
              });
            }
          } else {
            const count = yield* repo.countByOrgGlobal({ organizationId: ctx.organizationId });
            if (count >= MAX_VARS_PER_ORG_GLOBAL) {
              return yield* new BadRequest({
                message: `Maximum of ${MAX_VARS_PER_ORG_GLOBAL} global variables per organization reached`,
              });
            }
          }

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
          yield* assertPermission("envVar", "read");
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

          const { items } = yield* repo.list(filters);
          if (scope === "all") {
            const resolved = applyOverrideResolution(items);
            return {
              items: resolved.map((entry) => toApiEnvVar(entry.model, entry.overridesGlobal)),
            };
          }
          return { items: items.map((model) => toApiEnvVar(model)) };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "read");

          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

          return toApiEnvVar(model);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "update");
          const ctx = yield* CurrentActor;

          const repo = yield* EnvVarRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);

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
          yield* assertPermission("envVar", "delete");

          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

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
          yield* assertPermission("envVar", "read");

          const repo = yield* EnvVarRepo;
          const model = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(model.organizationId);

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
          yield* assertPermission("envVar", "update");

          const repo = yield* EnvVarRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);

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
    .handle("export", ({ urlParams }) => toApiBadRequestReadEffect(handleExport(urlParams))),
);
