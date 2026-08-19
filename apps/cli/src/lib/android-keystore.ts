import { X509Certificate, createHash } from "node:crypto";

import { Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

import type { ChildProcessSpawner } from "effect/unstable/process";

import { runExitCode, runText } from "./child-process";
import { BuildFailedError } from "./exit-codes";

const DEFAULT_KEYSTORE_VALIDITY_DAYS = 10_000;

export interface GenerateAndroidKeystoreInput {
  readonly outputPath: string;
  readonly keyAlias: string;
  readonly storePassword: string;
  readonly keyPassword: string;
  readonly commonName: string;
  readonly organization: string;
  readonly validityDays?: number;
}

export const renderDistinguishedName = (params: {
  readonly commonName: string;
  readonly organization: string;
}): string => `CN=${params.commonName}, O=${params.organization}`;

export interface KeystoreCertificate {
  readonly md5: string;
  readonly sha1: string;
  readonly sha256: string;
  /** notAfter as an ISO instant — the signing certificate's expiry. */
  readonly validUntil: string;
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/u;

/**
 * Pull the leaf certificate out of `keytool -list -rfc` output, which wraps each
 * PEM block in prose (alias name, entry type, chain length). The first block is
 * the leaf; the rest of a chain is its issuers, which say nothing about this key.
 */
export const parseKeystoreCertificatePem = (output: string): string | undefined =>
  PEM_CERTIFICATE.exec(output)?.[0];

const toColonHex = (digest: string): string => (digest.toUpperCase().match(/../gu) ?? []).join(":");

/**
 * The public facts a keystore's certificate carries: the three fingerprints the
 * Play Console and Firebase ask for, and the date after which anything signed
 * with it is rejected.
 *
 * Read from the DER rather than scraped from `keytool -list -v`: that output
 * renders dates through the JVM's default timezone as an abbreviation no
 * JavaScript Date can parse ("… until: Fri Sep 18 13:39:53 ICT 2026"), and drops
 * MD5 entirely on modern JDKs. Node's own digests come out in keytool's exact
 * uppercase colon-separated form, so the values are byte-identical to what a
 * developer sees when they run keytool themselves.
 */
export const readKeystoreCertificate = (pem: string): KeystoreCertificate => {
  const cert = new X509Certificate(pem);
  return {
    md5: toColonHex(createHash("md5").update(cert.raw).digest("hex")),
    sha1: cert.fingerprint,
    sha256: cert.fingerprint256,
    validUntil: cert.validToDate.toISOString(),
  };
};

/**
 * Run `keytool -list -rfc` against an on-disk keystore and read its signing
 * certificate. Only the store password is required to read a certificate. Used at
 * upload/generate time to populate the public, server-visible metadata the
 * dashboard renders.
 */
export const extractKeystoreCertificate = (params: {
  readonly keystorePath: string;
  readonly keyAlias: string;
  readonly storePassword: string;
}): Effect.Effect<KeystoreCertificate, BuildFailedError, ChildProcessSpawner.ChildProcessSpawner> =>
  runText(
    ChildProcess.make(
      "keytool",
      [
        "-list",
        "-rfc",
        "-keystore",
        params.keystorePath,
        "-alias",
        params.keyAlias,
        "-storepass",
        params.storePassword,
      ],
      // `extendEnv` is required: without it v4 hands the child ONLY this record,
      // so keytool would run without a PATH. The pin itself is what keeps
      // keytool's prose in English for the parser below.
      { env: { LC_ALL: "C" }, extendEnv: true },
    ),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new BuildFailedError({
          step: "read keystore certificate",
          exitCode: 1,
          message: `keytool -list failed to run (is the JDK installed?): ${String(cause)}`,
        }),
    ),
    Effect.flatMap((output) => {
      const pem = parseKeystoreCertificatePem(output);
      // `runText` resolves with whatever landed on stdout even when keytool
      // exits non-zero (wrong store password, unknown alias), so a missing PEM
      // block is the only reliable signal that the certificate was never read.
      // Fail loudly here — before any credential row is created — so the user
      // fixes the input instead of uploading metadata-less keystore.
      if (pem === undefined) {
        return Effect.fail(
          new BuildFailedError({
            step: "read keystore certificate",
            exitCode: 1,
            message: "keytool produced no certificate — verify the key alias and keystore password",
          }),
        );
      }
      return Effect.try({
        try: () => readKeystoreCertificate(pem),
        catch: (cause) =>
          new BuildFailedError({
            step: "read keystore certificate",
            exitCode: 1,
            message: `keystore certificate could not be parsed: ${String(cause)}`,
          }),
      });
    }),
  );

export const generateAndroidKeystore = (
  input: GenerateAndroidKeystoreInput,
): Effect.Effect<void, BuildFailedError, ChildProcessSpawner.ChildProcessSpawner> =>
  runExitCode(
    ChildProcess.make(
      "keytool",
      [
        "-genkeypair",
        "-v",
        "-storetype",
        "JKS",
        "-keystore",
        input.outputPath,
        "-alias",
        input.keyAlias,
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        String(input.validityDays ?? DEFAULT_KEYSTORE_VALIDITY_DAYS),
        "-storepass",
        input.storePassword,
        "-keypass",
        input.keyPassword,
        "-dname",
        renderDistinguishedName({
          commonName: input.commonName,
          organization: input.organization,
        }),
        "-noprompt",
      ],
      { stdout: "inherit", stderr: "inherit" },
    ),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new BuildFailedError({
          step: "generate android keystore",
          exitCode: 1,
          message: `generate android keystore failed to spawn: ${String(cause)}`,
        }),
    ),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new BuildFailedError({
              step: "generate android keystore",
              exitCode: code,
              message: `generate android keystore exited with code ${code}`,
            }),
          ),
    ),
  );
