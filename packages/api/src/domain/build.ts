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

export class BuildWithArtifact extends Schema.Class<BuildWithArtifact>("BuildWithArtifact")({
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

export const CreateBuildBody = Schema.Struct({
  projectId: Id,
  platform: Platform,
  profile: Schema.optional(Schema.String),
  distribution: Distribution,
  artifactFormat: ArtifactFormat,
  runtimeVersion: Schema.optional(Schema.String),
  appVersion: Schema.optional(Schema.String),
  buildNumber: Schema.optional(Schema.String),
  bundleId: Schema.optional(Schema.String),
  gitRef: Schema.optional(Schema.String),
  gitCommit: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

export const CompleteBuildBody = Schema.Struct({
  sha256: Schema.String,
  byteSize: Schema.Number,
});

export const ReserveBuildResult = Schema.Struct({
  id: Id,
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
});

export const DeleteBuildResult = Schema.Struct({
  deleted: Schema.Number,
});
