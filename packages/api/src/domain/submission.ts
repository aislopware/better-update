import { Schema } from "effect";

import { BundleIdentifier } from "./apple-provisioning-profile";
import { DateTimeString, DeletedResult, Id, Platform } from "./common";

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

// A submission row exists iff a client-side binary upload succeeded.
// `metadataComplete` is false when the upload landed but its post-upload store
// metadata step (iOS TestFlight config) did not; `buildVersion` (CFBundleVersion)
// keys the idempotent re-run that later completes it.
export class Submission extends Schema.Class<Submission>("Submission")({
  id: Id,
  organizationId: Id,
  projectId: Id,
  platform: Platform,
  profileName: Schema.String,
  archiveSource: SubmissionArchiveSource,
  buildId: Schema.NullOr(Id),
  archiveUrl: Schema.NullOr(Schema.String),
  iosConfig: Schema.NullOr(IosSubmissionConfig),
  androidConfig: Schema.NullOr(AndroidSubmissionConfig),
  metadataComplete: Schema.Boolean,
  buildVersion: Schema.NullOr(Schema.String),
  initiatingUserId: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
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
  // Defaults to true (a plain success). The iOS CLI sends false when the binary
  // uploaded but TestFlight config did not, and buildVersion (CFBundleVersion) to
  // key the idempotent re-run that later completes the same row.
  metadataComplete: Schema.optional(Schema.Boolean),
  buildVersion: Schema.optional(Schema.String),
});

export const DeleteSubmissionResult = DeletedResult;
