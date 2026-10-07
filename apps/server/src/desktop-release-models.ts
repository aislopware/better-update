/** Server-side shapes for desktop (macOS, Windows, Linux) update-feed releases. */
import type { DesktopArtifactFormat, DesktopPlatform } from "@better-update/api";

export type { DesktopArtifactFormat, DesktopPlatform } from "@better-update/api";

export interface DesktopReleaseModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly buildId: string;
  readonly platform: DesktopPlatform;
  readonly channel: string;
  readonly appVersion: string | null;
  readonly buildNumber: string | null;
  readonly artifactFormat: DesktopArtifactFormat;
  readonly releaseNotes: string | null;
  readonly critical: boolean;
  readonly rolloutPercentage: number;
  /** Sparkle `phasedRolloutInterval`, in hours; null = no phasing. */
  readonly phasedRolloutHours: number | null;
  readonly halted: boolean;
  readonly sha512: string;
  readonly sparkleEdSignature: string | null;
  readonly winSparkleEdSignature: string | null;
  readonly tauriSignature: string | null;
  /** Whether the artifact's electron-updater blockmap is stored (`.zip`, `.exe`). */
  readonly blockmap: boolean;
  /** How many Sparkle deltas the build has. */
  readonly sparkleDeltas: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A release joined with what a feed entry needs from its build + artifact. */
export interface DesktopFeedEntry extends DesktopReleaseModel {
  readonly bundleId: string | null;
  readonly metadataJson: string;
  readonly byteSize: number;
  readonly r2Key: string;
  /** The artifact's SHA-256, hex. */
  readonly sha256: string;
}

/** A Sparkle binary delta from an older version's bundle to a build's. */
export interface SparkleDeltaModel {
  readonly id: string;
  readonly buildId: string;
  /** The old bundle's CFBundleVersion. */
  readonly deltaFrom: string;
  readonly r2Key: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly edSignature: string;
  readonly sparkleExecutableSize: number | null;
  readonly sparkleLocales: string | null;
  readonly createdAt: string;
}
