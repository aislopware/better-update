import type { ArtifactFormat, Distribution } from "@better-update/api";

export type ArtifactFormatValue = typeof ArtifactFormat.Type;
export type DistributionValue = typeof Distribution.Type;

export const DISTRIBUTION_LABELS: Record<DistributionValue, string> = {
  "app-store": "App Store",
  "ad-hoc": "Ad Hoc",
  development: "Development",
  enterprise: "Enterprise",
  simulator: "Simulator",
  "play-store": "Play Store",
  direct: "Direct",
};

export const FORMAT_LABELS: Record<ArtifactFormatValue, string> = {
  ipa: "IPA",
  apk: "APK",
  aab: "AAB",
  "tar.gz": "tar.gz",
};

export { formatBytes } from "../../../../../lib/format-bytes";
