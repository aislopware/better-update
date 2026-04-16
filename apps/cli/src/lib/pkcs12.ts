import { getFormattedSerialNumber, getX509Certificate, parsePKCS12 } from "@expo/pkcs12";
import { Effect } from "effect";

import { CredentialValidationError } from "./exit-codes";

export interface P12Info {
  readonly serialNumber: string;
  readonly expiresAt: Date | undefined;
  readonly subject: string;
  readonly issuerCN: string | undefined;
  readonly signingIdentity: string;
}

/**
 * Parse a PKCS#12 (.p12) buffer and extract certificate metadata.
 */
export const inspectP12 = (params: {
  readonly data: Buffer;
  readonly password: string;
}): Effect.Effect<P12Info, CredentialValidationError> =>
  Effect.try({
    try: () => {
      const p12 = parsePKCS12(params.data, params.password);
      const cert = getX509Certificate(p12);

      const serialNumber = getFormattedSerialNumber(cert) ?? "unknown";

      const expiresAt = cert.validity.notAfter instanceof Date ? cert.validity.notAfter : undefined;

      const subjectParts = cert.subject.attributes.map(
        (attr) => `${attr.shortName ?? attr.name}=${attr.value}`,
      );
      const subject = subjectParts.join(", ");

      const issuerCN = cert.issuer.getField("CN")?.value as string | undefined;

      // Signing identity = Common Name from subject, e.g. "Apple Distribution: Name (TEAMID)"
      const cn = cert.subject.getField("CN")?.value as string | undefined;
      const signingIdentity = cn ?? subject;

      return { serialNumber, expiresAt, subject, issuerCN, signingIdentity };
    },
    catch: (error) =>
      new CredentialValidationError({
        message: `Failed to parse P12 certificate: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Check certificate expiry and return a warning message if applicable.
 */
export const checkCertExpiry = (expiresAt: Date | undefined, label: string): string | undefined => {
  if (!expiresAt) return undefined;
  const now = Date.now();
  const expiryMs = expiresAt.getTime();
  if (expiryMs < now) {
    return `WARNING: ${label} expired on ${expiresAt.toISOString()}`;
  }
  if (expiryMs - now < SEVEN_DAYS_MS) {
    return `WARNING: ${label} expires in less than 7 days (${expiresAt.toISOString()})`;
  }
  if (expiryMs - now < THIRTY_DAYS_MS) {
    return `WARNING: ${label} expires within 30 days (${expiresAt.toISOString()})`;
  }
  return undefined;
};
