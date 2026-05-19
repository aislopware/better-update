import { Schema } from "effect";

import { DateTimeString, Id, PaginationParams, Platform, UploadHeaders } from "./common";

export const Distribution = Schema.Literal(
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "play-store",
  "direct",
);

export const BuildAudience = Schema.Literal("internal", "store");

export const INTERNAL_DISTRIBUTIONS = [
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "direct",
] as const satisfies readonly (typeof Distribution.Type)[];

export const STORE_DISTRIBUTIONS = [
  "app-store",
  "play-store",
] as const satisfies readonly (typeof Distribution.Type)[];

export const ArtifactFormat = Schema.Literal("ipa", "apk", "aab", "tar.gz");
const Sha256Hex = Schema.String.pipe(Schema.pattern(/^[a-fA-F0-9]{64}$/u), Schema.maxLength(64));

const CreateBuildCommonFields = {
  projectId: Id,
  profile: Schema.optional(Schema.String),
  runtimeVersion: Schema.optional(Schema.String),
  appVersion: Schema.optional(Schema.String),
  buildNumber: Schema.optional(Schema.String),
  bundleId: Schema.optional(Schema.String),
  gitRef: Schema.optional(Schema.String),
  gitCommit: Schema.optional(Schema.String),
  gitDirty: Schema.optional(Schema.Boolean),
  message: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  fingerprintHash: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  sha256: Sha256Hex,
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
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
  gitDirty: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
  metadataJson: Schema.String,
  fingerprintHash: Schema.NullOr(Schema.String),
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

export const BuildSortColumn = Schema.Literal(
  "createdAt",
  "platform",
  "distribution",
  "runtimeVersion",
  "appVersion",
);

/**
 * Sort param: column name optionally prefixed with `-` for descending.
 * Example: `runtimeVersion` (asc), `-createdAt` (desc).
 */
export const BuildSort = Schema.Union(
  BuildSortColumn,
  Schema.TemplateLiteral("-", BuildSortColumn),
);

export const ListBuildsParams = Schema.Struct({
  projectId: Id,
  platform: Schema.optional(Platform),
  profile: Schema.optional(Schema.String),
  runtimeVersion: Schema.optional(Schema.String),
  distribution: Schema.optional(Distribution),
  audience: Schema.optional(BuildAudience),
  ...PaginationParams.fields,
  sort: Schema.optional(BuildSort),
});

export const CompleteBuildBody = Schema.Struct({
  sha256: Sha256Hex,
  byteSize: Schema.Number.pipe(Schema.nonNegative()),
});

export const ReserveBuildResult = Schema.Struct({
  id: Id,
  uploadMode: Schema.Literal("single"),
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
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
