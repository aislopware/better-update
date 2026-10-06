import { Schema } from "effect";

import { MacosArtifactFormat } from "./build";
import { DateTimeString, DeletedResult, Id, PaginationParams } from "./common";

/**
 * A desktop release: one macOS build published to an update-feed channel.
 * The feeds the server renders (Sparkle appcast, electron-updater
 * `<channel>-mac.yml`) list only releases — uploading a build ships nothing.
 *
 * `latest` is the default channel: untagged in the appcast (every Sparkle
 * client sees it) and `latest-mac.yml` for electron-updater. Any other name is
 * an opt-in channel (`sparkle:channel`, `<name>-mac.yml`).
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

/** Base64 of a 64-byte Ed25519 signature (Sparkle's `sparkle:edSignature`). */
const Ed25519SignatureBase64 = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9+/]{86}==$/u, {
    message: "sparkleEdSignature must be a base64 Ed25519 signature",
  }),
);

/** Base64 of a minisign signature box (Tauri's `.sig` content). */
const TauriSignature = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9+/]+={0,2}$/u, { message: "tauriSignature must be base64" }),
  Schema.isMaxLength(2048),
);

/**
 * electron-updater's blockmap of a `.zip` release: the archive cut into
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
  channel: Schema.String,
  appVersion: Schema.NullOr(Schema.String),
  buildNumber: Schema.NullOr(Schema.String),
  artifactFormat: MacosArtifactFormat,
  releaseNotes: Schema.NullOr(Schema.String),
  critical: Schema.Boolean,
  rolloutPercentage: Schema.Number,
  phasedRolloutHours: Schema.NullOr(Schema.Number),
  halted: Schema.Boolean,
  /** Whether the release carries a Sparkle EdDSA signature (Sparkle refuses unsigned archives). */
  sparkleSigned: Schema.Boolean,
  /** Whether the release carries a Tauri updater signature (Tauri feeds list only signed ones). */
  tauriSigned: Schema.Boolean,
  /** Whether electron-updater can download it differentially (a `.zip` with a blockmap). */
  blockmap: Schema.Boolean,
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
  tauriSignature: Schema.optional(TauriSignature),
  /** `.zip` only; its sizes must add up to the artifact's size. */
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
  channel: Schema.optional(DesktopReleaseChannel),
  buildId: Schema.optional(Id),
});

export const DeleteDesktopReleaseResult = DeletedResult;
