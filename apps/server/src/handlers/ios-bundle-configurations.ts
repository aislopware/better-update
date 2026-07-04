import { compact } from "@better-update/type-guards";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertIosCredentialRefs } from "../application/validate-credential-refs";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { toApiIosBundleConfiguration } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { IosBundleConfigurationRepo } from "../repositories/ios-bundle-configurations";

export const IosBundleConfigurationsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "iosBundleConfigurations",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(path.projectId);
            yield* assertAccess("iosBundleConfiguration", "read", {
              kind: "project",
              projectId: path.projectId,
            });
            const repo = yield* IosBundleConfigurationRepo;
            const items = yield* repo.listByProject({ projectId: path.projectId });
            return { items: items.map(toApiIosBundleConfiguration) };
          }),
        ),
      )
      .handle("create", ({ path, payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(path.projectId);
            yield* assertAccess("iosBundleConfiguration", "create", {
              kind: "project",
              projectId: path.projectId,
            });
            const ctx = yield* CurrentActor;
            const repo = yield* IosBundleConfigurationRepo;

            // Referenced credentials must exist in this org (fail-fast; the
            // resolve endpoint re-checks at build time).
            yield* assertIosCredentialRefs(payload);

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const model = {
              id,
              organizationId: ctx.organizationId,
              projectId: path.projectId,
              bundleIdentifier: payload.bundleIdentifier,
              distributionType: payload.distributionType,
              appleTeamId: payload.appleTeamId,
              appleDistributionCertificateId: toDbNull(payload.appleDistributionCertificateId),
              appleProvisioningProfileId: toDbNull(payload.appleProvisioningProfileId),
              applePushKeyId: toDbNull(payload.applePushKeyId),
              ascApiKeyId: toDbNull(payload.ascApiKeyId),
              targetName: toDbNull(payload.targetName),
              parentBundleIdentifier: toDbNull(payload.parentBundleIdentifier),
              createdAt: now,
              updatedAt: now,
            };

            yield* repo.insert(model);
            yield* logAudit({
              action: "ios.bundle-configuration.create",
              resourceType: "iosBundleConfiguration",
              resourceId: id,
              projectId: path.projectId,
              metadata: {
                bundleIdentifier: payload.bundleIdentifier,
                distributionType: payload.distributionType,
                ...compact({
                  targetName: payload.targetName,
                  parentBundleIdentifier: payload.parentBundleIdentifier,
                }),
              },
            });
            return toApiIosBundleConfiguration(model);
          }),
        ),
      )
      .handle("update", ({ path, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const repo = yield* IosBundleConfigurationRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAccess("iosBundleConfiguration", "update", {
              kind: "project",
              projectId: existing.projectId,
            });
            yield* assertIosCredentialRefs(payload);

            const now = new Date().toISOString();
            yield* repo.update({
              id: path.id,
              appleDistributionCertificateId: payload.appleDistributionCertificateId,
              appleProvisioningProfileId: payload.appleProvisioningProfileId,
              applePushKeyId: payload.applePushKeyId,
              ascApiKeyId: payload.ascApiKeyId,
              targetName: payload.targetName,
              parentBundleIdentifier: payload.parentBundleIdentifier,
              updatedAt: now,
            });
            yield* logAudit({
              action: "ios.bundle-configuration.update",
              resourceType: "iosBundleConfiguration",
              resourceId: path.id,
              projectId: existing.projectId,
              metadata: {
                bundleIdentifier: existing.bundleIdentifier,
                distributionType: existing.distributionType,
              },
            });
            const merged = yield* repo.findById({ id: path.id });
            return toApiIosBundleConfiguration(merged);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const repo = yield* IosBundleConfigurationRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAccess("iosBundleConfiguration", "delete", {
              kind: "project",
              projectId: existing.projectId,
            });
            yield* repo.delete({ id: path.id });
            yield* logAudit({
              action: "ios.bundle-configuration.delete",
              resourceType: "iosBundleConfiguration",
              resourceId: path.id,
              projectId: existing.projectId,
              metadata: {
                bundleIdentifier: existing.bundleIdentifier,
                distributionType: existing.distributionType,
              },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
