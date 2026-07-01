import { AndroidSubmissionConfig, IosSubmissionConfig, Submission } from "@better-update/api";
import { safeJsonParse } from "@better-update/safe-json";

import type {
  AndroidSubmissionConfigModel,
  IosSubmissionConfigModel,
  SubmissionModel,
} from "../submission-models";

// Pure submission domain-model -> API-schema mappers, extracted from to-api.ts
// to keep that file under the line budget. No I/O; sync mapping only.

type SubmissionConfigPayload = IosSubmissionConfigModel | AndroidSubmissionConfigModel;

const hasIosKeys = (config: SubmissionConfigPayload): config is IosSubmissionConfigModel =>
  "bundleIdentifier" in config;

const toApiIosSubmissionConfig = (config: SubmissionConfigPayload): IosSubmissionConfig | null => {
  if (!hasIosKeys(config)) {
    return null;
  }
  return new IosSubmissionConfig({
    appleId: config.appleId,
    ascAppId: config.ascAppId,
    appleTeamId: config.appleTeamId,
    sku: config.sku,
    language: config.language,
    companyName: config.companyName,
    appName: config.appName,
    bundleIdentifier: config.bundleIdentifier,
    ascApiKeyId: config.ascApiKeyId,
    groups: config.groups,
    whatToTest: config.whatToTest,
  });
};

const toApiAndroidSubmissionConfig = (
  config: SubmissionConfigPayload,
): AndroidSubmissionConfig | null => {
  if (hasIosKeys(config)) {
    return null;
  }
  return new AndroidSubmissionConfig({
    applicationId: config.applicationId,
    track: config.track,
    releaseStatus: config.releaseStatus,
    changesNotSentForReview: config.changesNotSentForReview,
    rollout: config.rollout,
    googleServiceAccountKeyId: config.googleServiceAccountKeyId,
  });
};

const parseSubmissionConfig = (json: string): SubmissionConfigPayload | null => {
  const parsed = safeJsonParse(json);
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- both sides of this JSON contract are owned by this server: write path serializes the union in handlers/submissions.ts, read path returns identical shape
  return parsed as SubmissionConfigPayload;
};

export const toApiSubmission = (model: SubmissionModel): Submission => {
  const config = parseSubmissionConfig(model.submissionConfigJson);
  const iosConfig =
    model.platform === "ios" && config !== null ? toApiIosSubmissionConfig(config) : null;
  const androidConfig =
    model.platform === "android" && config !== null ? toApiAndroidSubmissionConfig(config) : null;
  return new Submission({
    id: model.id,
    organizationId: model.organizationId,
    projectId: model.projectId,
    platform: model.platform,
    profileName: model.profileName,
    archiveSource: model.archiveSource,
    buildId: model.buildId,
    archiveUrl: model.archiveUrl,
    iosConfig,
    androidConfig,
    initiatingUserId: model.initiatingUserId,
    createdAt: model.createdAt,
  });
};
