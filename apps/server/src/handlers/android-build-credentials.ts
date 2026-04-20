import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { toApiAndroidBuildCredentials } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { AndroidApplicationIdentifierRepo } from "../repositories/android-application-identifiers";
import { AndroidBuildCredentialsRepo } from "../repositories/android-build-credentials";

export const AndroidBuildCredentialsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "androidBuildCredentials",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "read");
            const appIds = yield* AndroidApplicationIdentifierRepo;
            const parent = yield* appIds.findById({ id: path.applicationIdentifierId });
            yield* assertOrgOwnership(parent.organizationId);
            const repo = yield* AndroidBuildCredentialsRepo;
            const items = yield* repo.listByAppIdentifier({
              androidApplicationIdentifierId: path.applicationIdentifierId,
            });
            return { items: items.map(toApiAndroidBuildCredentials) };
          }),
        ),
      )
      .handle("create", ({ path, payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "create");
            const ctx = yield* CurrentActor;
            const appIds = yield* AndroidApplicationIdentifierRepo;
            const parent = yield* appIds.findById({ id: path.applicationIdentifierId });
            yield* assertOrgOwnership(parent.organizationId);
            const repo = yield* AndroidBuildCredentialsRepo;

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const isDefault = payload.isDefault ?? false;
            const model = {
              id,
              organizationId: ctx.organizationId,
              androidApplicationIdentifierId: path.applicationIdentifierId,
              androidUploadKeystoreId: toDbNull(payload.androidUploadKeystoreId),
              googleServiceAccountKeyForSubmissionsId: toDbNull(
                payload.googleServiceAccountKeyForSubmissionsId,
              ),
              googleServiceAccountKeyForFcmV1Id: toDbNull(
                payload.googleServiceAccountKeyForFcmV1Id,
              ),
              name: payload.name,
              isDefault,
              createdAt: now,
              updatedAt: now,
            };
            yield* repo.insert({ ...model, clearOtherDefaults: isDefault });
            yield* logAudit({
              action: "android.build-credentials.create",
              resourceType: "androidCredential",
              resourceId: id,
              projectId: parent.projectId,
              metadata: { name: payload.name, isDefault },
            });
            return toApiAndroidBuildCredentials(model);
          }),
        ),
      )
      .handle("update", ({ path, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "update");
            const repo = yield* AndroidBuildCredentialsRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);

            const now = new Date().toISOString();
            if (payload.isDefault === true) {
              yield* repo.clearDefault({
                androidApplicationIdentifierId: existing.androidApplicationIdentifierId,
                exceptId: path.id,
              });
            }
            yield* repo.update({
              id: path.id,
              ...(payload.name === undefined ? {} : { name: payload.name }),
              androidUploadKeystoreId: payload.androidUploadKeystoreId,
              googleServiceAccountKeyForSubmissionsId:
                payload.googleServiceAccountKeyForSubmissionsId,
              googleServiceAccountKeyForFcmV1Id: payload.googleServiceAccountKeyForFcmV1Id,
              ...(payload.isDefault === undefined ? {} : { isDefault: payload.isDefault }),
              updatedAt: now,
            });
            yield* logAudit({
              action: "android.build-credentials.update",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: {},
            });
            const merged = yield* repo.findById({ id: path.id });
            return toApiAndroidBuildCredentials(merged);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("androidCredential", "delete");
            const repo = yield* AndroidBuildCredentialsRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* repo.delete({ id: path.id });
            yield* logAudit({
              action: "android.build-credentials.delete",
              resourceType: "androidCredential",
              resourceId: path.id,
              metadata: { name: existing.name },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
