import { Option, Schema } from "effect";

import {
  csvList,
  DateTimeString,
  DeletedResult,
  Id,
  PaginationParams,
  sortParam,
  UploadHeaders,
} from "./common";
import { BuildInstallArtifact } from "./install-artifact";

/**
 * Platforms a build can target. Wider than `Platform`, which is the OTA
 * update platform: a macOS app is built, signed, notarized and distributed
 * here, but never receives Expo updates.
 */
export const BuildPlatform = Schema.Literals(["ios", "android", "macos"]);
export type BuildPlatform = typeof BuildPlatform.Type;

export const Distribution = Schema.Literals([
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "play-store",
  "direct",
  "developer-id",
]);

export const BuildAudience = Schema.Literals(["internal", "store"]);

export const INTERNAL_DISTRIBUTIONS = [
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "direct",
  "developer-id",
] as const satisfies readonly (typeof Distribution.Type)[];

export const STORE_DISTRIBUTIONS = [
  "app-store",
  "play-store",
] as const satisfies readonly (typeof Distribution.Type)[];

/**
 * iOS distributions installable on-device over-the-air via an itms-services
 * manifest. Each is signed with a provisioning profile that authorizes a direct
 * install: `development` and `ad-hoc` embed a device roster, `enterprise` is
 * org-wide. `app-store` builds ship through the App Store and `simulator`
 * artifacts (tar.gz) are not device-installable.
 */
export const OTA_INSTALLABLE_DISTRIBUTIONS = [
  "ad-hoc",
  "development",
  "enterprise",
] as const satisfies readonly (typeof Distribution.Type)[];

export const isOtaInstallableDistribution = (distribution: typeof Distribution.Type): boolean =>
  (OTA_INSTALLABLE_DISTRIBUTIONS as readonly string[]).includes(distribution);

export const ArtifactFormat = Schema.Literals(["ipa", "apk", "aab", "tar.gz", "dmg", "zip", "pkg"]);

/**
 * Containers a Developer ID-signed macOS app ships in. `tar.gz` is the
 * `.app.tar.gz` the Tauri updater installs (Sparkle reads it too).
 */
export const MacosArtifactFormat = Schema.Literals(["dmg", "zip", "pkg", "tar.gz"]);

/** How far Apple's notary service got with a build's shipped container. */
export const MacosNotarization = Schema.Struct({
  status: Schema.Literals(["accepted", "pending", "skipped"]),
  submissionId: Schema.optional(Schema.String),
  stapled: Schema.Boolean,
});
export type MacosNotarization = typeof MacosNotarization.Type;

/**
 * What a macOS build records under `metadata.macos`: the CLI writes it at
 * upload, the dashboard reads it back. `pending` is a submission Apple had not
 * finished with when the build uploaded — the app opens once it is accepted,
 * just without a stapled ticket for offline first launch.
 */
export const MacosBuildMetadata = Schema.Struct({
  /** The `.app` name without extension — what update feeds name the download. */
  appName: Schema.optional(Schema.String),
  minimumSystemVersion: Schema.optional(Schema.String),
  architectures: Schema.optional(Schema.Array(Schema.String)),
  teamId: Schema.optional(Schema.String),
  /** The app's `SUPublicEDKey`: releases must carry a signature it verifies. */
  sparklePublicKey: Schema.optional(Schema.String),
  /** A Tauri app's `plugins.updater.pubkey`: Tauri feed entries must be signed for it. */
  tauriPublicKey: Schema.optional(Schema.String),
  /** Absent when an upload did not go through the CLI's notarize step. */
  notarization: Schema.optional(MacosNotarization),
});
export type MacosBuildMetadata = typeof MacosBuildMetadata.Type;

const decodeMacosMetadataJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ macos: MacosBuildMetadata })),
);

/** A build's `metadata.macos`, or undefined when absent or not in this shape. */
export const readMacosBuildMetadata = (metadataJson: string): MacosBuildMetadata | undefined =>
  Option.getOrUndefined(decodeMacosMetadataJson(metadataJson))?.macos;
const Sha256Hex = Schema.String.check(
  Schema.isPattern(/^[a-fA-F0-9]{64}$/u),
  Schema.isMaxLength(64),
);

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
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  fingerprintHash: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  sha256: Sha256Hex,
  byteSize: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
} as const;

export const Build = Schema.Struct({
  id: Id,
  projectId: Id,
  platform: BuildPlatform,
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
}).annotate({ identifier: "Build" });
export type Build = typeof Build.Type;

export const BuildArtifact = Schema.Struct({
  buildId: Id,
  r2Key: Schema.String,
  format: ArtifactFormat,
  contentType: Schema.String,
  byteSize: Schema.Number,
  sha256: Schema.String,
  createdAt: DateTimeString,
}).annotate({ identifier: "BuildArtifact" });
export type BuildArtifact = typeof BuildArtifact.Type;

export const BuildWithArtifact = Schema.Struct({
  ...Build.fields,
  artifact: Schema.NullOr(
    Schema.Struct({
      r2Key: Schema.String,
      format: ArtifactFormat,
      contentType: Schema.String,
      byteSize: Schema.Number,
      sha256: Schema.String,
    }),
  ),
  /** Universal APK attached to an `aab` build — see {@link BuildInstallArtifact}. */
  installArtifact: Schema.NullOr(BuildInstallArtifact),
}).annotate({ identifier: "BuildWithArtifact" });
export type BuildWithArtifact = typeof BuildWithArtifact.Type;

export const CreateBuildBody = Schema.Union([
  Schema.Struct({
    ...CreateBuildCommonFields,
    platform: Schema.Literal("ios"),
    distribution: Schema.Literals(["app-store", "ad-hoc", "development", "enterprise"]),
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
  Schema.Struct({
    ...CreateBuildCommonFields,
    platform: Schema.Literal("macos"),
    distribution: Schema.Literal("developer-id"),
    artifactFormat: MacosArtifactFormat,
  }),
]);

export const BuildSortColumn = Schema.Literals([
  "createdAt",
  "platform",
  "distribution",
  "runtimeVersion",
  "appVersion",
]);

export const BuildSort = sortParam(BuildSortColumn);

export const ListBuildsParams = Schema.Struct({
  projectId: Id,
  // A list: with three build platforms, "any two" is a real filter.
  platform: Schema.optional(csvList(BuildPlatform)),
  profile: Schema.optional(Schema.String),
  runtimeVersion: Schema.optional(Schema.String),
  distribution: Schema.optional(csvList(Distribution)),
  audience: Schema.optional(BuildAudience),
  // Case-insensitive substring match on the build message, git commit SHA or git ref.
  query: Schema.optional(Schema.String),
  ...PaginationParams.fields,
  sort: Schema.optional(BuildSort),
});

export const CompleteBuildBody = Schema.Struct({
  sha256: Sha256Hex,
  byteSize: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const ReserveBuildResult = Schema.Struct({
  id: Id,
  uploadMode: Schema.Literal("single"),
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});

export const DeleteBuildResult = DeletedResult;

/**
 * `artifactUrl` always downloads the primary artifact (the `.ipa` / `.apk` /
 * `.aab` / simulator tarball). `installUrl` is what a device opens to install:
 * an `itms-services://` manifest for OTA-installable iOS builds, the signed
 * universal-APK route for `aab` builds carrying an install artifact, the
 * artifact itself for `apk` builds, and `null` where nothing is installable
 * (App Store / simulator builds, an `aab` uploaded without its APK).
 */
export const InstallLinkResult = Schema.Struct({
  token: Schema.String,
  expires: Schema.Number,
  artifactUrl: Schema.String,
  installUrl: Schema.NullOr(Schema.String),
});
