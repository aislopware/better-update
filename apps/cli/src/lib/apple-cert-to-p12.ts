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
  const field = cert.subject.getField(name) as { value?: unknown } | undefined;
  if (field === undefined || typeof field.value !== "string") {
    return null;
  }
  return field.value;
};

const matchTeamFromCommonName = (cn: string): string | null => {
  const match = /\(([A-Z0-9]{10})\)/u.exec(cn);
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
    const appleTeamId = extractTeamId(result.cert);
    if (appleTeamId === null) {
      return yield* Effect.fail(
        new CertParseError({
          message: "Could not extract Apple team identifier from certificate subject",
        }),
      );
    }
    return {
      p12Base64: result.p12Base64,
      password: result.password,
      metadata: {
        serialNumber: result.cert.serialNumber.toUpperCase(),
        validFrom: result.cert.validity.notBefore.toISOString(),
        validUntil: result.cert.validity.notAfter.toISOString(),
        appleTeamId,
        appleTeamName: stringField(result.cert, "O"),
        developerIdIdentifier: stringField(result.cert, "UID"),
        commonName: stringField(result.cert, "CN"),
      },
    };
  });
