/* eslint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-type-assertion -- @expo/pkcs12 exports declare node-forge cert shapes as `any`; this file is the narrowing boundary that produces the typed P12Info for the rest of the CLI */

import { getFormattedSerialNumber, getX509Certificate, parsePKCS12 } from "@expo/pkcs12";
import { Effect } from "effect";

import { CredentialValidationError } from "./exit-codes";

export interface P12Info {
  readonly serialNumber: string;
  readonly validFrom: Date | undefined;
  readonly expiresAt: Date | undefined;
  readonly subject: string;
  readonly issuerCN: string | undefined;
  readonly signingIdentity: string;
  readonly teamId: string | undefined;
}

const APPLE_TEAM_ID_RE = /^[A-Z0-9]{10}$/u;

const extractTeamId = (params: {
  readonly signingIdentity: string;
  readonly orgUnit: string | undefined;
}): string | undefined => {
  if (params.orgUnit && APPLE_TEAM_ID_RE.test(params.orgUnit)) {
    return params.orgUnit;
  }
  const parenMatch = /\(([A-Z0-9]{10})\)\s*$/u.exec(params.signingIdentity);
  return parenMatch?.[1];
};

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

      const validFrom =
        cert.validity.notBefore instanceof Date ? cert.validity.notBefore : undefined;
      const expiresAt = cert.validity.notAfter instanceof Date ? cert.validity.notAfter : undefined;

      const attrs = cert.subject.attributes as readonly {
        shortName?: string | undefined;
        name?: string | undefined;
        value: unknown;
      }[];
      const subjectParts: string[] = attrs.map((attr) => {
        const label = attr.shortName ?? attr.name;
        if (label === undefined) {
          return `(unknown)=${String(attr.value)}`;
        }
        return `${label}=${String(attr.value)}`;
      });
      const subject = subjectParts.join(", ");

      const issuerCNValue = cert.issuer.getField("CN")?.value;
      const issuerCN = typeof issuerCNValue === "string" ? issuerCNValue : undefined;

      // Signing identity = Common Name from subject, e.g. "Apple Distribution: Name (TEAMID)"
      const cnValue = cert.subject.getField("CN")?.value;
      const cn = typeof cnValue === "string" ? cnValue : undefined;
      const signingIdentity = cn ?? subject;
      const orgUnitValue = cert.subject.getField("OU")?.value;
      const orgUnit = typeof orgUnitValue === "string" ? orgUnitValue : undefined;

      const teamId = extractTeamId({ signingIdentity, orgUnit });

      return { serialNumber, validFrom, expiresAt, subject, issuerCN, signingIdentity, teamId };
    },
    catch: (error) =>
      new CredentialValidationError({
        message: `Failed to parse P12 certificate: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });
