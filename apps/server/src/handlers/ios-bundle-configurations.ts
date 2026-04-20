import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
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
            yield* assertPermission("iosBundleConfiguration", "read");
            yield* assertProjectOwnership(path.projectId);
            const repo = yield* IosBundleConfigurationRepo;
            const items = yield* repo.listByProject({ projectId: path.projectId });
            return { items: items.map(toApiIosBundleConfiguration) };
          }),
        ),
      )
      .handle("create", ({ path, payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertPermission("iosBundleConfiguration", "create");
            yield* assertProjectOwnership(path.projectId);
            const ctx = yield* CurrentActor;
            const repo = yield* IosBundleConfigurationRepo;

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
              },
            });
            return toApiIosBundleConfiguration(model);
          }),
        ),
      )
      .handle("update", ({ path, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertPermission("iosBundleConfiguration", "update");
            const repo = yield* IosBundleConfigurationRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);

            const now = new Date().toISOString();
            yield* repo.update({
              id: path.id,
              appleDistributionCertificateId: payload.appleDistributionCertificateId,
              appleProvisioningProfileId: payload.appleProvisioningProfileId,
              applePushKeyId: payload.applePushKeyId,
              ascApiKeyId: payload.ascApiKeyId,
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
            yield* assertPermission("iosBundleConfiguration", "delete");
            const repo = yield* IosBundleConfigurationRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
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
