import { Schema } from "effect";

import { DateTimeString, Id, Platform } from "./common";

export const Distribution = Schema.Literal(
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "play-store",
  "direct",
);

export const ArtifactFormat = Schema.Literal("ipa", "apk", "aab", "tar.gz");

const CreateBuildCommonFields = {
  projectId: Id,
  profile: Schema.optional(Schema.String),
  runtimeVersion: Schema.optional(Schema.String),
  appVersion: Schema.optional(Schema.String),
  buildNumber: Schema.optional(Schema.String),
  bundleId: Schema.optional(Schema.String),
  gitRef: Schema.optional(Schema.String),
  gitCommit: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
} as const;

export class Build extends Schema.Class<Build>("Build")({
  id: Id,
  projectId: Id,
  platform: Platform,
  profile: Schema.String,
  distribution: Distribution,
  runtimeVersion: Schema.NullOr(Schema.String),
  appVersion: Schema.NullOr(Schema.String),
  buildNumber: Schema.NullOr(Schema.String),
  bundleId: Schema.NullOr(Schema.String),
  gitRef: Schema.NullOr(Schema.String),
  gitCommit: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  metadataJson: Schema.String,
  createdAt: DateTimeString,
}) {}

export class BuildArtifact extends Schema.Class<BuildArtifact>("BuildArtifact")({
  buildId: Id,
  r2Key: Schema.String,
  format: ArtifactFormat,
  contentType: Schema.String,
  byteSize: Schema.Number,
  sha256: Schema.String,
  createdAt: DateTimeString,
}) {}

export class BuildWithArtifact extends Build.extend<BuildWithArtifact>("BuildWithArtifact")({
  artifact: Schema.NullOr(
    Schema.Struct({
      r2Key: Schema.String,
      format: ArtifactFormat,
      contentType: Schema.String,
      byteSize: Schema.Number,
      sha256: Schema.String,
    }),
  ),
}) {}

export class BuildCompatibilityChannel extends Schema.Class<BuildCompatibilityChannel>(
  "BuildCompatibilityChannel",
)({
  channelId: Id,
  channelName: Schema.String,
  updateCount: Schema.Number,
  latestUpdateId: Schema.NullOr(Id),
  latestUpdateMessage: Schema.NullOr(Schema.String),
  latestUpdateCreatedAt: Schema.NullOr(DateTimeString),
  isPaused: Schema.Boolean,
  rolloutActive: Schema.Boolean,
}) {}

export class BuildCompatibilityRow extends BuildWithArtifact.extend<BuildCompatibilityRow>(
  "BuildCompatibilityRow",
)({
  channels: Schema.Array(BuildCompatibilityChannel),
}) {}

export class MissingRuntimeVersionBuild extends Schema.Class<MissingRuntimeVersionBuild>(
  "MissingRuntimeVersionBuild",
)({
  channelId: Id,
  channelName: Schema.String,
  platform: Platform,
  runtimeVersion: Schema.String,
  updateCount: Schema.Number,
  latestUpdateId: Id,
  latestUpdateMessage: Schema.String,
  latestUpdateCreatedAt: DateTimeString,
  rolloutActive: Schema.Boolean,
}) {}

export const BuildCompatibilityMatrixResult = Schema.Struct({
  rows: Schema.Array(BuildCompatibilityRow),
  missingRuntimeVersions: Schema.Array(MissingRuntimeVersionBuild),
});

export const CreateBuildBody = Schema.Union(
  Schema.Struct({
    ...CreateBuildCommonFields,
    platform: Schema.Literal("ios"),
    distribution: Schema.Literal("app-store", "ad-hoc", "development", "enterprise"),
    artifactFormat: Schema.Literal("ipa"),
  }),
  Schema.Struct({
    ...CreateBuildCommonFields,
    platform: Schema.Literal("ios"),
    distribution: Schema.Literal("simulator"),
    artifactFormat: Schema.Literal("tar.gz"),
  }),
  Schema.Struct({
    ...CreateBuildCommonFields,
    platform: Schema.Literal("android"),
    distribution: Schema.Literal("play-store"),
    artifactFormat: Schema.Literal("aab"),
  }),
  Schema.Struct({
    ...CreateBuildCommonFields,
    platform: Schema.Literal("android"),
    distribution: Schema.Literal("direct"),
    artifactFormat: Schema.Literal("apk"),
  }),
);

export const CompleteBuildBody = Schema.Struct({
  sha256: Schema.String.pipe(Schema.minLength(64), Schema.maxLength(64)),
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
});

export const ReserveBuildResult = Schema.Struct({
  id: Id,
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
});

export const DeleteBuildResult = Schema.Struct({
  deleted: Schema.Number,
});

export const InstallLinkResult = Schema.Struct({
  token: Schema.String,
  expires: Schema.Number,
  artifactUrl: Schema.String,
  installUrl: Schema.NullOr(Schema.String),
});
