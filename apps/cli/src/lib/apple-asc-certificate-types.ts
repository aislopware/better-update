/**
 * The App Store Connect `certificateType` values a stored certificate kind can
 * appear under. Listing or matching a certificate on Apple by one type alone
 * misses the others:
 *
 * - Developer ID Application certificates issued since Apple's G2 intermediate
 *   (every one created in recent years) are `DEVELOPER_ID_APPLICATION_G2`, a
 *   value `@expo/apple-utils` has no enum member for; older ones stay
 *   `DEVELOPER_ID_APPLICATION`. Apple counts both against one limit.
 * - Apple issues one universal "Apple Distribution" certificate, and a stored
 *   `IOS_*` row could have been classified either way.
 * - `DEVELOPER_ID_INSTALLER` certificates are not in the API at all.
 */
// @expo/apple-utils is ncc-bundled CJS; the enums are read off the default import.
import AppleUtils from "@expo/apple-utils";

import type { AppleCertificateType } from "./apple-certificate-type";

// eslint-disable-next-line typescript/no-unsafe-type-assertion -- a real App Store Connect value missing from the @expo/apple-utils enum
const DEVELOPER_ID_APPLICATION_G2 = "DEVELOPER_ID_APPLICATION_G2" as AppleUtils.CertificateType;

const ASC_TYPES: Record<AppleCertificateType, readonly AppleUtils.CertificateType[]> = {
  IOS_DISTRIBUTION: [
    AppleUtils.CertificateType.IOS_DISTRIBUTION,
    AppleUtils.CertificateType.IOS_DEVELOPMENT,
  ],
  IOS_DEVELOPMENT: [
    AppleUtils.CertificateType.IOS_DEVELOPMENT,
    AppleUtils.CertificateType.IOS_DISTRIBUTION,
  ],
  MAC_APP_DEVELOPMENT: [AppleUtils.CertificateType.MAC_APP_DEVELOPMENT],
  MAC_APP_DISTRIBUTION: [AppleUtils.CertificateType.MAC_APP_DISTRIBUTION],
  MAC_INSTALLER_DISTRIBUTION: [AppleUtils.CertificateType.MAC_INSTALLER_DISTRIBUTION],
  DEVELOPER_ID_APPLICATION: [
    DEVELOPER_ID_APPLICATION_G2,
    AppleUtils.CertificateType.DEVELOPER_ID_APPLICATION,
  ],
  DEVELOPER_ID_INSTALLER: [],
};

/** Every App Store Connect type a stored certificate's serial may be found under. */
export const ascCertificateTypes = (
  certificateType: AppleCertificateType,
): readonly AppleUtils.CertificateType[] => ASC_TYPES[certificateType];

/**
 * The types that are the same kind of certificate (what Apple's per-kind limit
 * counts): the one requested, and for Developer ID both generations.
 */
export const ascCertificateTypesOfKind = (
  certificateType: AppleUtils.CertificateType,
): readonly AppleUtils.CertificateType[] =>
  certificateType === AppleUtils.CertificateType.DEVELOPER_ID_APPLICATION
    ? ASC_TYPES.DEVELOPER_ID_APPLICATION
    : [certificateType];
