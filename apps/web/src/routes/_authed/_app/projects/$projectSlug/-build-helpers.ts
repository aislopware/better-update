import type { ArtifactFormat } from "@better-update/api";

import { DISTRIBUTION_BADGE_LABELS } from "../../../../../components/attribute-badges";

export type ArtifactFormatValue = typeof ArtifactFormat.Type;

export const DISTRIBUTION_LABELS = DISTRIBUTION_BADGE_LABELS;

export const FORMAT_LABELS: Record<ArtifactFormatValue, string> = {
  ipa: "IPA",
  apk: "APK",
  aab: "AAB",
  "tar.gz": "tar.gz",
  dmg: "DMG",
  zip: "ZIP",
  pkg: "PKG",
  exe: "EXE",
  msi: "MSI",
  appimage: "AppImage",
  deb: "DEB",
  rpm: "RPM",
};

export { formatBytes } from "../../../../../lib/format-bytes";
