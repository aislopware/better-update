import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { toApiIosAppMetadata } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { IosAppMetadataRepo } from "../repositories/ios-app-metadata";

export const IosAppMetadataGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "iosAppMetadata",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(path.projectId);
            yield* assertAccess("iosAppMetadata", "read", {
              kind: "project",
              projectId: path.projectId,
            });
            const repo = yield* IosAppMetadataRepo;
            const items = yield* repo.listByProject({ projectId: path.projectId });
            return { items: items.map(toApiIosAppMetadata) };
          }),
        ),
      )
      .handle("create", ({ path, payload }) =>
        toApiWriteEffect(
          Effect.gen(function* () {
            yield* assertProjectOwnership(path.projectId);
            yield* assertAccess("iosAppMetadata", "create", {
              kind: "project",
              projectId: path.projectId,
            });
            const ctx = yield* CurrentActor;
            const repo = yield* IosAppMetadataRepo;

            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const model = {
              id,
              organizationId: ctx.organizationId,
              projectId: path.projectId,
              bundleIdentifier: payload.bundleIdentifier,
              ascAppId: toDbNull(payload.ascAppId),
              sku: toDbNull(payload.sku),
              language: payload.language ?? "en-US",
              companyName: toDbNull(payload.companyName),
              appName: toDbNull(payload.appName),
              createdAt: now,
              updatedAt: now,
            };
            yield* repo.insert(model);
            yield* logAudit({
              action: "ios.app-metadata.create",
              resourceType: "iosAppMetadata",
              resourceId: id,
              projectId: path.projectId,
              metadata: { bundleIdentifier: payload.bundleIdentifier },
            });
            return toApiIosAppMetadata(model);
          }),
        ),
      )
      .handle("update", ({ path, payload }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const repo = yield* IosAppMetadataRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAccess("iosAppMetadata", "update", {
              kind: "project",
              projectId: existing.projectId,
            });
            const now = new Date().toISOString();
            yield* repo.update({
              id: path.id,
              ascAppId: payload.ascAppId,
              sku: payload.sku,
              language: payload.language,
              companyName: payload.companyName,
              appName: payload.appName,
              updatedAt: now,
            });
            yield* logAudit({
              action: "ios.app-metadata.update",
              resourceType: "iosAppMetadata",
              resourceId: path.id,
              projectId: existing.projectId,
              metadata: { bundleIdentifier: existing.bundleIdentifier },
            });
            const merged = yield* repo.findById({ id: path.id });
            return toApiIosAppMetadata(merged);
          }),
        ),
      )
      .handle("delete", ({ path }) =>
        toApiCrudEffect(
          Effect.gen(function* () {
            const repo = yield* IosAppMetadataRepo;
            const existing = yield* repo.findById({ id: path.id });
            yield* assertOrgOwnership(existing.organizationId);
            yield* assertAccess("iosAppMetadata", "delete", {
              kind: "project",
              projectId: existing.projectId,
            });
            yield* repo.delete({ id: path.id });
            yield* logAudit({
              action: "ios.app-metadata.delete",
              resourceType: "iosAppMetadata",
              resourceId: path.id,
              projectId: existing.projectId,
              metadata: { bundleIdentifier: existing.bundleIdentifier },
            });
            return { deleted: 1 };
          }),
        ),
      ),
);
