import { Schema } from "effect";

import { DesktopArtifactFormat, DesktopPlatform } from "./build";
import { DateTimeString, DeletedResult, Id, PaginationParams, UploadHeaders } from "./common";

/**
 * A desktop release: one macOS, Windows or Linux build published to an
 * update-feed channel. The feeds the server renders (Sparkle / WinSparkle
 * appcasts, electron-updater channel files, Tauri JSON) list only releases —
 * uploading a build ships nothing.
 *
 * `latest` is the default channel: untagged in the appcast (every Sparkle
 * client sees it) and `latest[-mac|-linux].yml` for electron-updater. Any
 * other name is an opt-in channel (`sparkle:channel`, `<name>[-mac].yml`).
 */
export const DesktopReleaseChannel = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,39}$/u, {
    message: "Channel must be 1–40 lowercase letters, digits, '.', '_' or '-'",
  }),
);

export const DEFAULT_DESKTOP_CHANNEL = "latest";

const RolloutPercentage = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
);

/** Base64 of a SHA-512 digest (what electron-updater verifies). */
const Sha512Base64 = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9+/]{86}==$/u, { message: "sha512 must be a base64 SHA-512 digest" }),
);

/** Base64 of a 64-byte Ed25519 signature (Sparkle's and WinSparkle's `sparkle:edSignature`). */
const Ed25519SignatureBase64 = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9+/]{86}==$/u, {
    message: "an EdDSA signature must be a base64 Ed25519 signature",
  }),
);

/** Base64 of a minisign signature box (Tauri's `.sig` content). */
const TauriSignature = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u, { message: "tauriSignature must be base64" }),
  Schema.isMaxLength(2048),
);

/**
 * electron-updater's blockmap of a `.zip` or NSIS `.exe` release: the file cut into
 * content-defined chunks, each named by a checksum, computed by the CLI. The
 * server serves it gzipped as `<file>.blockmap`, so an updater holding the
 * previous zip downloads only the chunks that changed. Up to 4 GiB in chunks
 * of at least 16 KiB.
 */
const MAX_BLOCKS = 262_144;
export const ElectronBlockmapChunks = Schema.Struct({
  checksums: Schema.Array(
    Schema.String.check(
      Schema.isPattern(/^[A-Za-z0-9+/]{4,88}={0,2}$/u, {
        message: "blockmap checksums must be base64",
      }),
    ),
  ).check(Schema.isMaxLength(MAX_BLOCKS)),
  sizes: Schema.Array(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 16_777_216 })),
  ).check(Schema.isMaxLength(MAX_BLOCKS)),
});

const ReleaseNotes = Schema.String.check(Schema.isMaxLength(20_000));

/**
 * Sparkle's phased rollout: clients fall into 7 groups, and one more group
 * gets the release every this many hours after it is published. Critical
 * releases and manual checks bypass it; electron-updater ignores it.
 */
const PhasedRolloutHours = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 720 }),
);

export const DesktopRelease = Schema.Struct({
  id: Id,
  projectId: Id,
  buildId: Id,
  platform: DesktopPlatform,
  channel: Schema.String,
  appVersion: Schema.NullOr(Schema.String),
  buildNumber: Schema.NullOr(Schema.String),
  artifactFormat: DesktopArtifactFormat,
  releaseNotes: Schema.NullOr(Schema.String),
  critical: Schema.Boolean,
  rolloutPercentage: Schema.Number,
  phasedRolloutHours: Schema.NullOr(Schema.Number),
  halted: Schema.Boolean,
  /** Whether the release carries a Sparkle EdDSA signature (Sparkle refuses unsigned archives). */
  sparkleSigned: Schema.Boolean,
  /** Whether the release carries a Tauri updater signature (Tauri feeds list only signed ones). */
  tauriSigned: Schema.Boolean,
  /** Whether a Windows release carries a WinSparkle EdDSA signature. */
  winSparkleSigned: Schema.Boolean,
  /**
   * Whether electron-updater can download it differentially: a `.zip` or NSIS
   * `.exe` with an uploaded blockmap, or an AppImage with an embedded one.
   */
  blockmap: Schema.Boolean,
  /**
   * Sparkle binary deltas the build's appcast item offers (macOS): how many
   * older versions update to it by patch instead of the whole archive.
   */
  sparkleDeltas: Schema.Number,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}).annotate({ identifier: "DesktopRelease" });
export type DesktopRelease = typeof DesktopRelease.Type;

export const CreateDesktopReleaseBody = Schema.Struct({
  buildId: Id,
  channel: DesktopReleaseChannel,
  releaseNotes: Schema.optional(ReleaseNotes),
  critical: Schema.optional(Schema.Boolean),
  rolloutPercentage: Schema.optional(RolloutPercentage),
  phasedRolloutHours: Schema.optional(PhasedRolloutHours),
  /** Computed by the CLI over the stored artifact — the server never reads the bytes. */
  sha512: Sha512Base64,
  sparkleEdSignature: Schema.optional(Ed25519SignatureBase64),
  /** Windows only: the installer's WinSparkle EdDSA signature. */
  winSparkleEdSignature: Schema.optional(Ed25519SignatureBase64),
  tauriSignature: Schema.optional(TauriSignature),
  /** `.zip` and `.exe` only; its sizes must add up to the artifact's size. */
  electronBlockmap: Schema.optional(ElectronBlockmapChunks),
});

export const UpdateDesktopReleaseBody = Schema.Struct({
  halted: Schema.optional(Schema.Boolean),
  rolloutPercentage: Schema.optional(RolloutPercentage),
  phasedRolloutHours: Schema.optional(Schema.NullOr(PhasedRolloutHours)),
  releaseNotes: Schema.optional(Schema.NullOr(ReleaseNotes)),
  critical: Schema.optional(Schema.Boolean),
});

export const ListDesktopReleasesParams = Schema.Struct({
  ...PaginationParams.fields,
  platform: Schema.optional(DesktopPlatform),
  channel: Schema.optional(DesktopReleaseChannel),
  buildId: Schema.optional(Id),
});

export const DeleteDesktopReleaseResult = DeletedResult;

/** A bundle version as Sparkle compares it (`CFBundleVersion`). */
const SparkleBundleVersion = Schema.String.check(
  Schema.isPattern(/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u, {
    message: "deltaFrom must be a bundle version (CFBundleVersion)",
  }),
);

const Sha256Hex = Schema.String.check(
  Schema.isPattern(/^[a-fA-F0-9]{64}$/u, { message: "sha256 must be a hex SHA-256 digest" }),
);

const DeltaByteSize = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 4_294_967_296 }),
);

/** Non-English `.lproj` names of the old app's Sparkle framework, comma-separated. */
const SparkleLocales = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*$/u, {
    message: "sparkleLocales must be comma-separated locale names",
  }),
  Schema.isMaxLength(512),
);

/**
 * A Sparkle binary delta: the patch Sparkle's BinaryDelta made from an older
 * version's app bundle to this build's, listed in the build's appcast item
 * under `<sparkle:deltas>`. A Sparkle client whose `CFBundleVersion` equals
 * `deltaFrom` downloads it instead of the whole archive (and falls back to the
 * archive if applying it fails).
 */
export const SparkleDelta = Schema.Struct({
  id: Id,
  buildId: Id,
  deltaFrom: Schema.String,
  byteSize: Schema.Number,
  sha256: Schema.String,
  sparkleExecutableSize: Schema.NullOr(Schema.Number),
  sparkleLocales: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
}).annotate({ identifier: "SparkleDelta" });
export type SparkleDelta = typeof SparkleDelta.Type;

export const ReserveSparkleDeltaBody = Schema.Struct({
  deltaFrom: SparkleBundleVersion,
  sha256: Sha256Hex,
  byteSize: DeltaByteSize,
  /** The delta file's EdDSA signature, by the key that signs the build's archive. */
  edSignature: Ed25519SignatureBase64,
  sparkleExecutableSize: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  sparkleLocales: Schema.optional(SparkleLocales),
});

export const SparkleDeltaUploadReservation = Schema.Struct({
  uploadUrl: Schema.String,
  uploadExpiresAt: DateTimeString,
  uploadHeaders: UploadHeaders,
});

export const CompleteSparkleDeltaBody = Schema.Struct({
  deltaFrom: SparkleBundleVersion,
  sha256: Sha256Hex,
  byteSize: DeltaByteSize,
});

export const ListSparkleDeltasResult = Schema.Struct({
  items: Schema.Array(SparkleDelta),
});
