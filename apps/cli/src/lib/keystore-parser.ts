import { X509Certificate } from "node:crypto";

import { Effect } from "effect";

import { CredentialValidationError } from "./exit-codes";

export interface KeystoreKeyEntry {
  readonly alias: string;
  readonly hasCert: boolean;
  readonly hasKey: boolean;
  readonly expiresAt: Date | undefined;
}

export interface KeystoreInfo {
  readonly aliases: readonly string[];
  readonly entries: readonly KeystoreKeyEntry[];
}

/**
 * Parse a JKS or PKCS#12 keystore buffer and extract entry metadata.
 * Uses jks-js which supports both formats (auto-detected).
 */
export const inspectKeystore = (params: {
  readonly data: Buffer;
  readonly password: string;
}): Effect.Effect<KeystoreInfo, CredentialValidationError> =>
  Effect.try({
    try: () => {
      // jks-js is CJS-only with no type declarations
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jks-js is CJS-only
      const jks = require("jks-js") as {
        toPem: (
          keystore: Buffer,
          password: string,
        ) => Record<string, { cert?: string; key?: string; ca?: string }>;
      };

      const pem = jks.toPem(params.data, params.password);
      const aliases = Object.keys(pem);
      const entries: KeystoreKeyEntry[] = aliases.map((alias) => {
        const certPem = pem[alias]?.cert;
        let expiresAt: Date | undefined;
        if (certPem) {
          try {
            const x509 = new X509Certificate(certPem);
            expiresAt = new Date(x509.validTo);
          } catch {
            // cert parsing failure is non-fatal
          }
        }
        return {
          alias,
          hasCert: !!(certPem || pem[alias]?.ca),
          hasKey: !!pem[alias]?.key,
          expiresAt,
        };
      });

      return { aliases, entries };
    },
    catch: (error) =>
      new CredentialValidationError({
        message: `Failed to parse keystore: ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

/**
 * Validate that a keystore contains the expected key alias.
 */
export const validateKeystoreAlias = (
  info: KeystoreInfo,
  expectedAlias: string,
): string | undefined => {
  if (!info.aliases.includes(expectedAlias)) {
    return `WARNING: Keystore does not contain alias "${expectedAlias}". Available aliases: ${info.aliases.join(", ")}`;
  }
  const entry = info.entries.find((e) => e.alias === expectedAlias);
  if (entry && !entry.hasKey) {
    return `WARNING: Alias "${expectedAlias}" does not contain a private key`;
  }
  return undefined;
};
