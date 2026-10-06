/** Server-side shapes for desktop (macOS) update-feed releases. */
import type { MacosArtifactFormat } from "@better-update/api";

export type DesktopArtifactFormat = typeof MacosArtifactFormat.Type;

export interface DesktopReleaseModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly buildId: string;
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
  readonly tauriSignature: string | null;
  /** Whether the artifact's electron-updater blockmap is stored. */
  readonly blockmap: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A release joined with what a feed entry needs from its build + artifact. */
export interface DesktopFeedEntry extends DesktopReleaseModel {
  readonly bundleId: string | null;
  readonly metadataJson: string;
  readonly byteSize: number;
  readonly r2Key: string;
}
