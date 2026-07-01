import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import type { CreateSubmissionBody } from "@better-update/api";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership, assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { BadRequest } from "../errors";
import { toApiSubmission } from "../http/to-api";
import { toApiCrudEffect, toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { parsePagination } from "../lib/pagination";
import { requireValue } from "../lib/require-value";
import { SubmissionsRepo } from "../repositories/submissions";

import type { AndroidSubmissionConfigModel, IosSubmissionConfigModel } from "../submission-models";

type CreatePayload = typeof CreateSubmissionBody.Type;

const buildIosConfig = (
  ios: NonNullable<CreatePayload["iosConfig"]> | undefined,
  bundleIdentifier: string,
): IosSubmissionConfigModel => ({
  appleId: toDbNull(ios?.appleId),
  ascAppId: toDbNull(ios?.ascAppId),
  appleTeamId: toDbNull(ios?.appleTeamId),
  sku: toDbNull(ios?.sku),
  language: ios?.language ?? "en-US",
  companyName: toDbNull(ios?.companyName),
  appName: toDbNull(ios?.appName),
  bundleIdentifier,
  ascApiKeyId: toDbNull(ios?.ascApiKeyId),
  groups: ios?.groups ?? [],
  whatToTest: toDbNull(ios?.whatToTest),
});

const buildAndroidConfig = (
  android: NonNullable<CreatePayload["androidConfig"]> | undefined,
  applicationId: string,
): AndroidSubmissionConfigModel => ({
  applicationId,
  track: android?.track ?? "internal",
  releaseStatus: android?.releaseStatus ?? "completed",
  changesNotSentForReview: android?.changesNotSentForReview ?? false,
  rollout: toDbNull(android?.rollout),
  googleServiceAccountKeyId: toDbNull(android?.googleServiceAccountKeyId),
});

const resolveSubmissionConfig = (payload: CreatePayload) =>
  Effect.gen(function* () {
    if (payload.platform === "ios") {
      const bundleIdentifier = yield* requireValue(
        payload.iosConfig?.bundleIdentifier,
        "iosConfig.bundleIdentifier",
      );
      return buildIosConfig(payload.iosConfig, bundleIdentifier);
    }
    const applicationId = yield* requireValue(
      payload.androidConfig?.applicationId,
      "androidConfig.applicationId",
    );
    return buildAndroidConfig(payload.androidConfig, applicationId);
  });

export const SubmissionsGroupLive = HttpApiBuilder.group(ManagementApi, "submissions", (handlers) =>
  handlers
    .handle("list", ({ path, urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(path.projectId);
          yield* assertAccess("submission", "read", {
            kind: "submission",
            projectId: path.projectId,
          });
          const repo = yield* SubmissionsRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { items, total } = yield* repo.listByProject({
            projectId: path.projectId,
            platform: urlParams.platform,
            profile: urlParams.profile,
            buildId: urlParams.buildId,
            limit,
            offset,
          });
          return { items: items.map(toApiSubmission), total, page, limit };
        }),
      ),
    )
    .handle("create", ({ path, payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(path.projectId);
          yield* assertAccess("submission", "create", {
            kind: "submission",
            projectId: path.projectId,
          });
          const ctx = yield* CurrentActor;
          const repo = yield* SubmissionsRepo;

          if (payload.platform === "ios" && payload.iosConfig === undefined) {
            return yield* new BadRequest({
              message: "iosConfig is required for iOS submissions",
            });
          }
          if (payload.platform === "android" && payload.androidConfig === undefined) {
            return yield* new BadRequest({
              message: "androidConfig is required for Android submissions",
            });
          }
          if (
            payload.archiveSource === "build" &&
            (payload.buildId === undefined || payload.buildId === "")
          ) {
            return yield* new BadRequest({
              message: "buildId is required when archiveSource is 'build'",
            });
          }
          if (
            (payload.archiveSource === "path" || payload.archiveSource === "url") &&
            (payload.archiveUrl === undefined || payload.archiveUrl === "")
          ) {
            return yield* new BadRequest({
              message: "archiveUrl is required when archiveSource is 'path' or 'url'",
            });
          }

          const now = new Date().toISOString();
          const submissionConfig = yield* resolveSubmissionConfig(payload);
          const profileName = payload.profileName ?? "production";
          const metadataComplete = payload.metadataComplete ?? true;
          const submissionConfigJson = JSON.stringify(submissionConfig);

          // Idempotent per build: a re-run that re-uploads/re-configures the same
          // CFBundleVersion updates its existing row (e.g. flipping metadata_complete
          // to true) instead of appending a duplicate. Only iOS carries a version.
          const existing =
            payload.buildVersion === undefined || payload.buildVersion === ""
              ? null
              : yield* repo.findLatestByBuildVersion({
                  projectId: path.projectId,
                  platform: payload.platform,
                  buildVersion: payload.buildVersion,
                });

          const id = existing?.id ?? crypto.randomUUID();
          yield* existing === null
            ? repo.insert({
                id,
                organizationId: ctx.organizationId,
                projectId: path.projectId,
                platform: payload.platform,
                profileName,
                archiveSource: payload.archiveSource,
                buildId: toDbNull(payload.buildId),
                archiveUrl: toDbNull(payload.archiveUrl),
                submissionConfigJson,
                metadataComplete,
                buildVersion: toDbNull(payload.buildVersion),
                initiatingUserId: ctx.userId,
                createdAt: now,
              })
            : repo.update({
                id,
                profileName,
                archiveSource: payload.archiveSource,
                buildId: toDbNull(payload.buildId),
                archiveUrl: toDbNull(payload.archiveUrl),
                submissionConfigJson,
                metadataComplete,
                initiatingUserId: ctx.userId,
                createdAt: now,
              });
          yield* logAudit({
            action: "submission.create",
            resourceType: "submission",
            resourceId: id,
            projectId: path.projectId,
            metadata: {
              platform: payload.platform,
              profile: profileName,
              archiveSource: payload.archiveSource,
              metadataComplete,
            },
          });
          const persisted = yield* repo.findById({ id });
          return toApiSubmission(persisted);
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* SubmissionsRepo;
          const submission = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(submission.organizationId);
          yield* assertAccess("submission", "read", {
            kind: "submission",
            projectId: submission.projectId,
            submissionId: path.id,
          });
          return toApiSubmission(submission);
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* SubmissionsRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          yield* assertAccess("submission", "delete", {
            kind: "submission",
            projectId: existing.projectId,
            submissionId: path.id,
          });
          yield* repo.delete({ id: path.id });
          yield* logAudit({
            action: "submission.delete",
            resourceType: "submission",
            resourceId: path.id,
            projectId: existing.projectId,
            metadata: { platform: existing.platform },
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
