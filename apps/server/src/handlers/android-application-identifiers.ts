import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { toApiAndroidApplicationIdentifier } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { AndroidApplicationIdentifierRepo } from "../repositories/android-application-identifiers";
import { AndroidBuildCredentialsRepo } from "../repositories/android-build-credentials";

export const AndroidApplicationIdentifiersGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "androidApplicationIdentifiers",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(path.projectId);
            yield* assertAccess("androidCredential", "read", {
              kind: "project",
              projectId: path.projectId,
            });
            const repo = yield* AndroidApplicationIdentifierRepo;
            const items = yield* repo.listByProject({ projectId: path.projectId });
            return { items: items.map(toApiAndroidApplicationIdentifier) };
          }),
        ),
      )
      .handle("create", ({ path, payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(path.projectId);
            yield* assertAccess("androidCredential", "create", {
              kind: "project",
              projectId: path.projectId,
            });
            const ctx = yield* CurrentActor;
            const repo = yield* AndroidApplicationIdentifierRepo;
            const groupsRepo = yield* AndroidBuildCredentialsRepo;

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const model = {
              id,
              organizationId: ctx.organizationId,
              projectId: path.projectId,
              packageName: payload.packageName,
              createdAt: now,
              updatedAt: now,
            };
            yield* repo.insert(model);

            const defaultGroupId = crypto.randomUUID();
            yield* groupsRepo.insert({
              id: defaultGroupId,
              organizationId: ctx.organizationId,
              androidApplicationIdentifierId: id,
              androidUploadKeystoreId: null,
              googleServiceAccountKeyForSubmissionsId: null,
              googleServiceAccountKeyForFcmV1Id: null,
              name: "Default",
              isDefault: true,
              createdAt: now,
              updatedAt: now,
            });

            yield* logAudit({
              action: "android.application-identifier.create",
              resourceType: "androidCredential",
              resourceId: id,
              projectId: path.projectId,
              metadata: { packageName: payload.packageName },
            });
            return toApiAndroidApplicationIdentifier(model);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const repo = yield* AndroidApplicationIdentifierRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAccess("androidCredential", "delete", {
              kind: "project",
              projectId: existing.projectId,
            });
            yield* repo.delete({ id: path.id });
            yield* logAudit({
              action: "android.application-identifier.delete",
              resourceType: "androidCredential",
              resourceId: path.id,
              projectId: existing.projectId,
              metadata: { packageName: existing.packageName },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
