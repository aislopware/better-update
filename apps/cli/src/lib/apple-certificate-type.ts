/**
 * Which kind of Apple signing certificate a `.p12` holds, read from the
 * certificate's own subject.
 *
 * Apple does not put the App Store Connect `certificateType` anywhere in the
 * X.509 — what it does put there is a common name whose prefix names the kind
 * ("Developer ID Application: Acme Inc (A1B2C3D4E5)"). Every certificate that
 * reaches the server is parsed locally anyway (the vault is zero-knowledge, so
 * the CLI is the only place that sees the plaintext), which makes the subject
 * the one signal available at upload time as well as at generation time.
 */
import type { AppleCertificateType } from "@better-update/api";

export type { AppleCertificateType };

export { APPLE_CERTIFICATE_TYPE_LABELS, isMacosCertificateType } from "@better-update/api";

/** Common-name prefixes, including the pre-2021 spellings Apple still honours. */
const COMMON_NAME_PREFIXES: readonly (readonly [string, AppleCertificateType])[] = [
  ["developer id application:", "DEVELOPER_ID_APPLICATION"],
  ["developer id installer:", "DEVELOPER_ID_INSTALLER"],
  ["3rd party mac developer application:", "MAC_APP_DISTRIBUTION"],
  ["3rd party mac developer installer:", "MAC_INSTALLER_DISTRIBUTION"],
  ["mac app distribution:", "MAC_APP_DISTRIBUTION"],
  ["mac installer distribution:", "MAC_INSTALLER_DISTRIBUTION"],
  ["mac developer:", "MAC_APP_DEVELOPMENT"],
  ["iphone distribution:", "IOS_DISTRIBUTION"],
  ["iphone developer:", "IOS_DEVELOPMENT"],
  ["apple distribution:", "IOS_DISTRIBUTION"],
  ["apple development:", "IOS_DEVELOPMENT"],
];

/**
 * Classify a certificate from its common name.
 *
 * "Apple Distribution" / "Apple Development" are the universal certificates
 * Apple issues today: one certificate signs both iOS and Mac App Store builds,
 * and ASC reports them as the `IOS_*` types — so that is what they map to here.
 * Only the macOS-exclusive kinds (Developer ID, and the older 3rd-party Mac
 * certificates) become macOS types.
 *
 * An unrecognized name falls back to `IOS_DISTRIBUTION`, which is how every row
 * predating mig 0101 is read — so an odd certificate keeps behaving the way it
 * did rather than dropping out of the iOS lists.
 */
export const certificateTypeFromCommonName = (
  commonName: string | null | undefined,
): AppleCertificateType => {
  if (!commonName) {
    return "IOS_DISTRIBUTION";
  }
  const normalized = commonName.trim().toLowerCase();
  const match = COMMON_NAME_PREFIXES.find(([prefix]) => normalized.startsWith(prefix));
  return match?.[1] ?? "IOS_DISTRIBUTION";
};
