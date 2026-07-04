import { compact } from "@better-update/type-guards";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertAndroidCredentialRefs } from "../application/validate-credential-refs";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
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
            const appIds = yield* AndroidApplicationIdentifierRepo;
            const parent = yield* appIds.findById({ id: path.applicationIdentifierId });
            yield* assertOrgOwnership(parent.organizationId);
            yield* assertAccess("androidCredential", "read", {
              kind: "project",
              projectId: parent.projectId,
            });
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
            const ctx = yield* CurrentActor;
            const appIds = yield* AndroidApplicationIdentifierRepo;
            const parent = yield* appIds.findById({ id: path.applicationIdentifierId });
            yield* assertOrgOwnership(parent.organizationId);
            yield* assertAccess("androidCredential", "create", {
              kind: "project",
              projectId: parent.projectId,
            });
            // Referenced credentials must exist in this org (fail-fast; the
            // resolve endpoint re-checks at build time).
            yield* assertAndroidCredentialRefs(payload);
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
            const repo = yield* AndroidBuildCredentialsRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const appIds = yield* AndroidApplicationIdentifierRepo;
            const parent = yield* appIds.findById({ id: existing.androidApplicationIdentifierId });
            yield* assertAccess("androidCredential", "update", {
              kind: "project",
              projectId: parent.projectId,
            });
            yield* assertAndroidCredentialRefs(payload);

            const now = new Date().toISOString();
            if (payload.isDefault === true) {
              yield* repo.clearDefault({
                androidApplicationIdentifierId: existing.androidApplicationIdentifierId,
                exceptId: path.id,
              });
            }
            yield* repo.update({
              id: path.id,
              androidUploadKeystoreId: payload.androidUploadKeystoreId,
              googleServiceAccountKeyForSubmissionsId:
                payload.googleServiceAccountKeyForSubmissionsId,
              googleServiceAccountKeyForFcmV1Id: payload.googleServiceAccountKeyForFcmV1Id,
              updatedAt: now,
              ...compact({ name: payload.name, isDefault: payload.isDefault }),
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
            const repo = yield* AndroidBuildCredentialsRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            const appIds = yield* AndroidApplicationIdentifierRepo;
            const parent = yield* appIds.findById({ id: existing.androidApplicationIdentifierId });
            yield* assertAccess("androidCredential", "delete", {
              kind: "project",
              projectId: parent.projectId,
            });
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
