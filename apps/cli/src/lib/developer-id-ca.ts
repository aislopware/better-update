/**
 * Which Developer ID intermediate issued a certificate. Apple moved new
 * Developer ID certificates to the "G2" Sub-CA in 2019; the original one
 * expires on 2027-02-01, after which installer packages signed by its
 * certificates stop installing (timestamped, notarized apps keep launching).
 * The issuer's OU is `G2` for the new CA and `Apple Certification Authority`
 * for the original.
 */
import type { AppleCertificateType } from "./apple-certificate-type";

export const DEVELOPER_ID_G1_SUNSET = "2027-02-01";

const DEVELOPER_ID_CA_NAME = "Developer ID Certification Authority";

export const developerIdCaGeneration = (params: {
  readonly certificateType: AppleCertificateType;
  readonly issuerCN: string | undefined;
  readonly issuerOrgUnit: string | undefined;
}): "G1" | "G2" | undefined => {
  const isDeveloperId =
    params.certificateType === "DEVELOPER_ID_APPLICATION" ||
    params.certificateType === "DEVELOPER_ID_INSTALLER";
  if (!isDeveloperId || params.issuerCN !== DEVELOPER_ID_CA_NAME) {
    return undefined;
  }
  return params.issuerOrgUnit === "G2" ? "G2" : "G1";
};

export const developerIdG1Warning = (signingIdentity: string): string =>
  `"${signingIdentity}" was issued by the original Developer ID CA (G1), which expires on ${DEVELOPER_ID_G1_SUNSET}. Apps signed and notarized before then keep launching, but installer packages signed with it stop installing. Create a replacement: new Developer ID certificates come from the G2 CA.`;
