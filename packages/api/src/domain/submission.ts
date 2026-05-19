import { Schema } from "effect";

import { BundleIdentifier } from "./apple-provisioning-profile";
import { DateTimeString, Id, Platform } from "./common";

export const SubmissionStatus = Schema.Literal(
  "AWAITING_BUILD",
  "IN_QUEUE",
  "IN_PROGRESS",
  "FINISHED",
  "ERRORED",
  "CANCELED",
);

export const SubmissionArchiveSource = Schema.Literal("build", "path", "url");

export const AndroidReleaseStatus = Schema.Literal("completed", "draft", "halted", "inProgress");

export const AndroidTrack = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100));

export const Rollout = Schema.Number.pipe(Schema.greaterThan(0), Schema.lessThanOrEqualTo(1));

export class IosSubmissionConfig extends Schema.Class<IosSubmissionConfig>("IosSubmissionConfig")({
  appleId: Schema.NullOr(Schema.String),
  ascAppId: Schema.NullOr(Schema.String),
  appleTeamId: Schema.NullOr(Schema.String),
  sku: Schema.NullOr(Schema.String),
  language: Schema.String,
  companyName: Schema.NullOr(Schema.String),
  appName: Schema.NullOr(Schema.String),
  bundleIdentifier: Schema.String,
  ascApiKeyId: Schema.NullOr(Id),
  groups: Schema.Array(Schema.String),
  whatToTest: Schema.NullOr(Schema.String),
}) {}

export class AndroidSubmissionConfig extends Schema.Class<AndroidSubmissionConfig>(
  "AndroidSubmissionConfig",
)({
  applicationId: Schema.String,
  track: Schema.String,
  releaseStatus: AndroidReleaseStatus,
  changesNotSentForReview: Schema.Boolean,
  rollout: Schema.NullOr(Schema.Number),
  googleServiceAccountKeyId: Schema.NullOr(Id),
}) {}

export class Submission extends Schema.Class<Submission>("Submission")({
  id: Id,
  organizationId: Id,
  projectId: Id,
  platform: Platform,
  profileName: Schema.String,
  status: SubmissionStatus,
  archiveSource: SubmissionArchiveSource,
  buildId: Schema.NullOr(Id),
  archiveUrl: Schema.NullOr(Schema.String),
  iosConfig: Schema.NullOr(IosSubmissionConfig),
  androidConfig: Schema.NullOr(AndroidSubmissionConfig),
  errorCode: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  logFiles: Schema.Array(Schema.String),
  initiatingUserId: Schema.NullOr(Schema.String),
  queuedAt: Schema.NullOr(DateTimeString),
  startedAt: Schema.NullOr(DateTimeString),
  completedAt: Schema.NullOr(DateTimeString),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const CreateIosSubmissionBody = Schema.Struct({
  appleId: Schema.optional(Schema.String),
  ascAppId: Schema.optional(Schema.String),
  appleTeamId: Schema.optional(Schema.String),
  sku: Schema.optional(Schema.String),
  language: Schema.optional(Schema.String),
  companyName: Schema.optional(Schema.String),
  appName: Schema.optional(Schema.String),
  bundleIdentifier: BundleIdentifier,
  ascApiKeyId: Schema.optional(Id),
  groups: Schema.optional(Schema.Array(Schema.String)),
  whatToTest: Schema.optional(Schema.String),
});

export const CreateAndroidSubmissionBody = Schema.Struct({
  applicationId: Schema.String,
  track: Schema.optional(AndroidTrack),
  releaseStatus: Schema.optional(AndroidReleaseStatus),
  changesNotSentForReview: Schema.optional(Schema.Boolean),
  rollout: Schema.optional(Rollout),
  googleServiceAccountKeyId: Schema.optional(Id),
});

export const CreateSubmissionBody = Schema.Struct({
  platform: Platform,
  profileName: Schema.optional(Schema.String),
  archiveSource: SubmissionArchiveSource,
  buildId: Schema.optional(Id),
  archiveUrl: Schema.optional(Schema.String),
  iosConfig: Schema.optional(CreateIosSubmissionBody),
  androidConfig: Schema.optional(CreateAndroidSubmissionBody),
});

export const UpdateSubmissionStatusBody = Schema.Struct({
  status: SubmissionStatus,
  errorCode: Schema.optional(Schema.NullOr(Schema.String)),
  errorMessage: Schema.optional(Schema.NullOr(Schema.String)),
  logFiles: Schema.optional(Schema.Array(Schema.String)),
});

export const CancelSubmissionResult = Schema.Struct({ canceled: Schema.Boolean });

export const DeleteSubmissionResult = Schema.Struct({ deleted: Schema.Number });
