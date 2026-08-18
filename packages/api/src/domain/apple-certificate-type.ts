import { Schema } from "effect";

/**
 * The Apple signing-certificate kinds a stored `.p12` can be, mirroring the App
 * Store Connect `certificateType` attribute.
 *
 * Before this existed every row in `apple_distribution_certificates` was assumed
 * to be an iOS distribution certificate, and a macOS Developer ID certificate
 * was recognized only by the `UID` subject field it happens to carry — a
 * heuristic that could not tell a Developer ID Installer from a Mac App Store
 * certificate, and that an uploaded (rather than generated) `.p12` never filled
 * in at all. The type is now recorded at upload time from the certificate's own
 * subject, so each kind can be listed, filtered and used on its own.
 */
export const AppleCertificateType = Schema.Literal(
  "IOS_DEVELOPMENT",
  "IOS_DISTRIBUTION",
  "MAC_APP_DEVELOPMENT",
  "MAC_APP_DISTRIBUTION",
  "MAC_INSTALLER_DISTRIBUTION",
  "DEVELOPER_ID_APPLICATION",
  "DEVELOPER_ID_INSTALLER",
);

export type AppleCertificateType = typeof AppleCertificateType.Type;

/**
 * The kinds that sign macOS software. `MAC_APP_*` go through the Mac App Store;
 * the `DEVELOPER_ID_*` pair signs apps and installer packages distributed
 * outside it (and is what `better-update macos sign` uses).
 */
export const MACOS_CERTIFICATE_TYPES = [
  "MAC_APP_DEVELOPMENT",
  "MAC_APP_DISTRIBUTION",
  "MAC_INSTALLER_DISTRIBUTION",
  "DEVELOPER_ID_APPLICATION",
  "DEVELOPER_ID_INSTALLER",
] as const satisfies readonly AppleCertificateType[];

const MACOS_SET: ReadonlySet<string> = new Set(MACOS_CERTIFICATE_TYPES);

/** True for the certificate kinds that sign macOS software rather than iOS apps. */
export const isMacosCertificateType = (type: AppleCertificateType): boolean => MACOS_SET.has(type);

/** Human labels for CLI output and dashboard cells. */
export const APPLE_CERTIFICATE_TYPE_LABELS: Readonly<Record<AppleCertificateType, string>> = {
  IOS_DEVELOPMENT: "Apple Development",
  IOS_DISTRIBUTION: "Apple Distribution",
  MAC_APP_DEVELOPMENT: "Mac Development",
  MAC_APP_DISTRIBUTION: "Mac App Distribution",
  MAC_INSTALLER_DISTRIBUTION: "Mac Installer Distribution",
  DEVELOPER_ID_APPLICATION: "Developer ID Application",
  DEVELOPER_ID_INSTALLER: "Developer ID Installer",
};
