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

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"] as const;
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[idx]}`;
};
