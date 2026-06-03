import { Data, Effect } from "effect";
import forge from "node-forge";

export class CertParseError extends Data.TaggedError("CertParseError")<{
  readonly message: string;
}> {}

export interface CertMetadata {
  readonly serialNumber: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly appleTeamId: string;
  readonly appleTeamName: string | null;
  readonly developerIdIdentifier: string | null;
  readonly commonName: string | null;
}

export interface P12Bundle {
  readonly p12Base64: string;
  readonly password: string;
  readonly metadata: CertMetadata;
}

const APPLE_TEAM_ID_RE = /^[A-Z0-9]{10}$/u;

const stringField = (cert: forge.pki.Certificate, name: string): string | null => {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- forge.pki.CertificateField has `value: any` from @types/node-forge; narrow to unknown before the typeof guard
  const value = (cert.subject.getField(name) as { value?: unknown } | null | undefined)?.value;
  return typeof value === "string" ? value : null;
};

const matchTeamFromCommonName = (cn: string): string | null => {
  const match = /\((?<team>[A-Z0-9]{10})\)/u.exec(cn);
  if (match === null) {
    return null;
  }
  const [, captured] = match;
  return captured === undefined ? null : captured;
};

const extractTeamId = (cert: forge.pki.Certificate): string | null => {
  const ou = stringField(cert, "OU");
  if (ou !== null && APPLE_TEAM_ID_RE.test(ou)) {
    return ou;
  }
  const cn = stringField(cert, "CN");
  if (cn === null) {
    return null;
  }
  return matchTeamFromCommonName(cn);
};

const parseCert = (certDerBytes: string): forge.pki.Certificate => {
  const asn1 = forge.asn1.fromDer(certDerBytes);
  return forge.pki.certificateFromAsn1(asn1);
};

const generatePassword = (): string => forge.util.encode64(forge.random.getBytesSync(16));

const extractCertMetadata = (
  cert: forge.pki.Certificate,
): Effect.Effect<CertMetadata, CertParseError> =>
  Effect.gen(function* () {
    const appleTeamId = extractTeamId(cert);
    if (appleTeamId === null) {
      return yield* new CertParseError({
        message: "Could not extract Apple team identifier from certificate subject",
      });
    }
    return {
      serialNumber: cert.serialNumber.toUpperCase(),
      validFrom: cert.validity.notBefore.toISOString(),
      validUntil: cert.validity.notAfter.toISOString(),
      appleTeamId,
      appleTeamName: stringField(cert, "O"),
      developerIdIdentifier: stringField(cert, "UID"),
      commonName: stringField(cert, "CN"),
    };
  });

/**
 * Parse a PKCS#12 base64 bundle and extract certificate metadata. Used by the
 * Apple-ID flow which receives a P12 directly from `createCertificateAndP12Async`
 * and needs metadata before uploading to the better-update server.
 */
export const extractMetadataFromP12 = (params: {
  readonly p12Base64: string;
  readonly password: string;
}): Effect.Effect<CertMetadata, CertParseError> =>
  Effect.gen(function* () {
    const certBagOid = forge.pki.oids["certBag"];
    if (certBagOid === undefined) {
      return yield* new CertParseError({ message: "PKCS#12 OID lookup for certBag failed" });
    }
    const bags = yield* Effect.try({
      try: () => {
        const p12Der = forge.util.decode64(params.p12Base64);
        const p12Asn1 = forge.asn1.fromDer(p12Der);
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, params.password);
        const certBags = p12.getBags({ bagType: certBagOid });
        return certBags[certBagOid] ?? [];
      },
      catch: (error) =>
        new CertParseError({
          message: `Failed to parse PKCS#12 bundle: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });
    const [first] = bags;
    if (first?.cert === undefined) {
      return yield* new CertParseError({
        message: "PKCS#12 bundle does not contain a certificate",
      });
    }
    return yield* extractCertMetadata(first.cert);
  });

export const buildDistributionCertP12 = (params: {
  readonly certificateContentBase64: string;
  readonly privateKey: forge.pki.rsa.PrivateKey;
}): Effect.Effect<P12Bundle, CertParseError> =>
  Effect.gen(function* () {
    const result = yield* Effect.try({
      try: () => {
        const certDer = forge.util.decode64(params.certificateContentBase64);
        const cert = parseCert(certDer);
        const password = generatePassword();
        const p12Asn1 = forge.pkcs12.toPkcs12Asn1(params.privateKey, [cert], password, {
          friendlyName: "key",
          algorithm: "3des",
        });
        const p12Base64 = forge.util.encode64(forge.asn1.toDer(p12Asn1).getBytes());
        return { cert, p12Base64, password };
      },
      catch: (error) =>
        new CertParseError({
          message: `Failed to assemble .p12: ${error instanceof Error ? error.message : String(error)}`,
        }),
    });
    const metadata = yield* extractCertMetadata(result.cert);
    return {
      p12Base64: result.p12Base64,
      password: result.password,
      metadata,
    };
  });
