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
          const items = yield* repo.listByProject({
            projectId: path.projectId,
            status: urlParams.status,
            platform: urlParams.platform,
            profile: urlParams.profile,
            buildId: urlParams.buildId,
          });
          return { items: items.map(toApiSubmission) };
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

          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          const submissionConfig = yield* resolveSubmissionConfig(payload);
          const profileName = payload.profileName ?? "production";
          const initialStatus = payload.archiveSource === "build" ? "AWAITING_BUILD" : "IN_QUEUE";

          yield* repo.insert({
            id,
            organizationId: ctx.organizationId,
            projectId: path.projectId,
            platform: payload.platform,
            profileName,
            status: initialStatus,
            archiveSource: payload.archiveSource,
            buildId: toDbNull(payload.buildId),
            archiveUrl: toDbNull(payload.archiveUrl),
            submissionConfigJson: JSON.stringify(submissionConfig),
            initiatingUserId: ctx.userId,
            queuedAt: initialStatus === "IN_QUEUE" ? now : null,
            createdAt: now,
            updatedAt: now,
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
    .handle("updateStatus", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* SubmissionsRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          yield* assertAccess("submission", "update", {
            kind: "submission",
            projectId: existing.projectId,
            submissionId: path.id,
          });

          const now = new Date().toISOString();
          const terminal =
            payload.status === "FINISHED" ||
            payload.status === "ERRORED" ||
            payload.status === "CANCELED";
          const startingProgress = payload.status === "IN_PROGRESS" && existing.startedAt === null;

          yield* repo.updateStatus({
            id: path.id,
            status: payload.status,
            errorCode: payload.errorCode,
            errorMessage: payload.errorMessage,
            logFilesJson:
              payload.logFiles === undefined ? undefined : JSON.stringify(payload.logFiles),
            startedAt: startingProgress ? now : undefined,
            completedAt: terminal ? now : undefined,
            updatedAt: now,
          });
          yield* logAudit({
            action: "submission.status",
            resourceType: "submission",
            resourceId: path.id,
            projectId: existing.projectId,
            metadata: { status: payload.status },
          });
          const merged = yield* repo.findById({ id: path.id });
          return toApiSubmission(merged);
        }),
      ),
    )
    .handle("cancel", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          const repo = yield* SubmissionsRepo;
          const existing = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(existing.organizationId);
          yield* assertAccess("submission", "cancel", {
            kind: "submission",
            projectId: existing.projectId,
            submissionId: path.id,
          });
          if (
            existing.status !== "AWAITING_BUILD" &&
            existing.status !== "IN_QUEUE" &&
            existing.status !== "IN_PROGRESS"
          ) {
            return yield* new BadRequest({
              message: `Cannot cancel submission in terminal state ${existing.status}`,
            });
          }
          const now = new Date().toISOString();
          yield* repo.updateStatus({
            id: path.id,
            status: "CANCELED",
            completedAt: now,
            updatedAt: now,
          });
          yield* logAudit({
            action: "submission.cancel",
            resourceType: "submission",
            resourceId: path.id,
            projectId: existing.projectId,
            metadata: { previousStatus: existing.status },
          });
          return { canceled: true };
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
            metadata: { platform: existing.platform, status: existing.status },
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
