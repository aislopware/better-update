import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
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
  toEnvVarModel,
  validateEnvironments,
  validateKey,
} from "./env-vars-helpers";

import type { EnvVarListFilters, EnvVarRow } from "../repositories/env-vars";

export const EnvVarsGroupLive = HttpApiBuilder.group(ManagementApi, "env-vars", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "create");
          const ctx = yield* CurrentActor;

          const { scope, projectId } = payload;
          yield* assertScopeOwnership(scope, projectId);

          const environments = yield* validateEnvironments(payload.environments);
          yield* validateKey(payload.key);

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

          const row = yield* repo.insert({
            id: crypto.randomUUID(),
            organizationId: ctx.organizationId,
            projectId: scope === "project" ? toDbNull(projectId) : null,
            scope,
            key: payload.key,
            visibility: payload.visibility,
            value: payload.value,
            environments,
          });

          const envVar = toEnvVarModel(row);

          yield* logAudit({
            action: "envVar.create",
            resourceType: "envVar",
            resourceId: envVar.id,
            ...(scope === "project" && projectId ? { projectId } : {}),
            metadata: {
              key: payload.key,
              scope,
              environments,
              visibility: payload.visibility,
            },
          });

          return toApiEnvVar(envVar);
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

          const resolved =
            scope === "all"
              ? applyOverrideResolution(items)
              : items.map((row) => ({ row, overridesGlobal: false }));

          return {
            items: resolved.map((entry) =>
              toApiEnvVar(toEnvVarModel(entry.row, entry.overridesGlobal)),
            ),
          };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "read");

          const repo = yield* EnvVarRepo;
          const row = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(row.organization_id);

          return toApiEnvVar(toEnvVarModel(row));
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "update");

          const repo = yield* EnvVarRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organization_id);

          const newEnvironments = payload.environments
            ? yield* validateEnvironments(payload.environments)
            : undefined;

          const row = yield* repo.update({
            id: path.id,
            ...(payload.value === undefined ? {} : { value: payload.value }),
            ...(payload.visibility ? { visibility: payload.visibility } : {}),
          });

          if (newEnvironments) {
            yield* repo.replaceEnvironments({ id: path.id, environments: newEnvironments });
          }

          const finalRow: EnvVarRow = newEnvironments
            ? { ...row, environments: newEnvironments }
            : row;

          yield* logAudit({
            action: "envVar.update",
            resourceType: "envVar",
            resourceId: path.id,
            ...(existing.project_id ? { projectId: existing.project_id } : {}),
            metadata: {
              ...(payload.visibility ? { visibility: payload.visibility } : {}),
              ...(newEnvironments ? { environments: newEnvironments } : {}),
            },
          });

          return toApiEnvVar(toEnvVarModel(finalRow));
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          yield* assertPermission("envVar", "delete");

          const repo = yield* EnvVarRepo;
          const row = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(row.organization_id);

          yield* repo.deleteById({ id: path.id });

          yield* logAudit({
            action: "envVar.delete",
            resourceType: "envVar",
            resourceId: path.id,
            ...(row.project_id ? { projectId: row.project_id } : {}),
          });

          return { id: path.id };
        }),
      ),
    )
    .handle("bulkImport", ({ payload }) =>
      toApiBadRequestReadEffect(
        Effect.gen(function* () {
          const { created, updated, skipped, environments } = yield* handleBulkImport(payload);

          yield* logAudit({
            action: "envVar.bulkImport",
            resourceType: "envVar",
            ...(payload.scope === "project" && payload.projectId
              ? { projectId: payload.projectId }
              : {}),
            metadata: {
              scope: payload.scope,
              ...(payload.projectId ? { projectId: payload.projectId } : {}),
              environments,
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
