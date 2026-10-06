/**
 * Certificate signing requests for the Account Holder hand-off: only the
 * Account Holder can create a Developer ID certificate (an Admin's ASC key gets
 * 403), so the private key is made here, the CSR travels to them, and the
 * `.cer` they download comes back to be paired with the key into a `.p12`.
 *
 * Requests and certificates are matched by the SHA-256 of the public key
 * (SubjectPublicKeyInfo DER) — the one thing a CSR and the certificate issued
 * for it are guaranteed to share.
 */
import { X509Certificate, createHash, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";

import { Effect } from "effect";
import forge from "node-forge";

import { CredentialValidationError } from "./exit-codes";

export interface SigningRequest {
  readonly privateKeyPem: string;
  readonly csrPem: string;
  /** Hex SHA-256 of the public key; names the pending request on disk. */
  readonly publicKeyFingerprint: string;
}

/** Hex SHA-256 of a public key's SubjectPublicKeyInfo DER. */
export const publicKeyFingerprint = (key: KeyObject): string =>
  createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");

/**
 * A 2048-bit RSA key (what Apple's portal requires) and a CSR carrying the
 * requester's name and email — Keychain Access's "Request a Certificate From a
 * Certificate Authority", without Keychain Access.
 */
export const createSigningRequest = (params: {
  readonly commonName: string;
  readonly email: string;
}): Effect.Effect<SigningRequest, CredentialValidationError> =>
  Effect.try({
    try: () => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
      const csr = forge.pki.createCertificationRequest();
      csr.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }));
      csr.setSubject([
        { name: "commonName", value: params.commonName },
        { name: "emailAddress", value: params.email },
      ]);
      csr.sign(forge.pki.privateKeyFromPem(privateKeyPem), forge.md.sha256.create());
      return {
        privateKeyPem,
        csrPem: forge.pki.certificationRequestToPem(csr),
        publicKeyFingerprint: publicKeyFingerprint(publicKey),
      };
    },
    catch: (error) =>
      new CredentialValidationError({
        message: `Could not create the signing request: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

/** The subject CN, e.g. `Developer ID Application: Example Inc (ABCDE12345)`. */
export const certificateCommonName = (certificate: X509Certificate): string | undefined =>
  certificate.subject
    .split("\n")
    .find((part) => part.startsWith("CN="))
    ?.slice("CN=".length);

/** Parse a `.cer` as Apple ships it (DER) or as PEM. */
export const readCertificate = (
  bytes: Uint8Array,
): Effect.Effect<X509Certificate, CredentialValidationError> =>
  Effect.try({
    try: () => new X509Certificate(Buffer.from(bytes)),
    catch: () =>
      new CredentialValidationError({
        message: "Not an X.509 certificate (expected the .cer downloaded from Apple).",
      }),
  });

/**
 * Pair a certificate with its private key into a password-protected `.p12`,
 * the shape every vault certificate is stored in.
 */
export const buildP12 = (params: {
  readonly certificate: X509Certificate;
  readonly privateKeyPem: string;
  readonly password: string;
}): Effect.Effect<Uint8Array, CredentialValidationError> =>
  Effect.try({
    try: () => {
      const cert = forge.pki.certificateFromPem(params.certificate.toString());
      const p12 = forge.pkcs12.toPkcs12Asn1(
        forge.pki.privateKeyFromPem(params.privateKeyPem),
        [cert],
        params.password,
        { friendlyName: certificateCommonName(params.certificate) ?? "key", algorithm: "3des" },
      );
      return Uint8Array.from(Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));
    },
    catch: (error) =>
      new CredentialValidationError({
        message: `Could not assemble the .p12: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });
