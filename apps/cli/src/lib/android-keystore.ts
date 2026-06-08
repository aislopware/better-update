import { Command } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

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

export interface KeystoreFingerprints {
  readonly md5: string | undefined;
  readonly sha1: string | undefined;
  readonly sha256: string | undefined;
}

const FINGERPRINT_PATTERNS = {
  md5: /MD5:\s*(?<value>[0-9A-F:]+)/iu,
  sha1: /SHA-?1:\s*(?<value>[0-9A-F:]+)/iu,
  sha256: /SHA-?256:\s*(?<value>[0-9A-F:]+)/iu,
} as const;

/**
 * Parse certificate fingerprints out of `keytool -list -v` output. The fingerprint
 * labels (`MD5:`, `SHA1:`, `SHA256:`) are stable across keytool locales — only the
 * surrounding prose is translated — so label-anchored regexes are robust. MD5 is
 * absent on modern JDKs (dropped from `-v` output); that field stays `undefined`.
 * keytool already emits the canonical uppercase, colon-separated form the dashboard
 * displays verbatim, so no normalization is needed.
 */
export const parseKeystoreFingerprints = (output: string): KeystoreFingerprints => ({
  md5: output.match(FINGERPRINT_PATTERNS.md5)?.groups?.["value"],
  sha1: output.match(FINGERPRINT_PATTERNS.sha1)?.groups?.["value"],
  sha256: output.match(FINGERPRINT_PATTERNS.sha256)?.groups?.["value"],
});

/**
 * Run `keytool -list -v` against an on-disk keystore and extract its certificate
 * fingerprints. Only the store password is required to read a certificate. Used at
 * upload/generate time to populate the public, server-visible fingerprint metadata
 * the dashboard renders.
 */
export const extractKeystoreFingerprints = (params: {
  readonly keystorePath: string;
  readonly keyAlias: string;
  readonly storePassword: string;
}): Effect.Effect<KeystoreFingerprints, BuildFailedError, CommandExecutor.CommandExecutor> =>
  Command.string(
    Command.make(
      "keytool",
      "-list",
      "-v",
      "-keystore",
      params.keystorePath,
      "-alias",
      params.keyAlias,
      "-storepass",
      params.storePassword,
    ).pipe(Command.env({ LC_ALL: "C" })),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new BuildFailedError({
          step: "extract keystore fingerprints",
          exitCode: 1,
          message: `keytool -list failed to run (is the JDK installed?): ${String(cause)}`,
        }),
    ),
    Effect.flatMap((output) => {
      const fingerprints = parseKeystoreFingerprints(output);
      // `Command.string` resolves with whatever landed on stdout even when keytool
      // exits non-zero (wrong store password, unknown alias), so an empty
      // fingerprint set is the only reliable signal that the certificate was never
      // read. Fail loudly here — before any credential row is created — so the user
      // fixes the input instead of uploading a fingerprint-less keystore.
      if (fingerprints.sha1 === undefined && fingerprints.sha256 === undefined) {
        return Effect.fail(
          new BuildFailedError({
            step: "extract keystore fingerprints",
            exitCode: 1,
            message:
              "keytool produced no SHA-1/SHA-256 fingerprints — verify the key alias and keystore password",
          }),
        );
      }
      return Effect.succeed(fingerprints);
    }),
  );

export const generateAndroidKeystore = (
  input: GenerateAndroidKeystoreInput,
): Effect.Effect<void, BuildFailedError, CommandExecutor.CommandExecutor> =>
  Command.exitCode(
    Command.make(
      "keytool",
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
    ).pipe(Command.stdout("inherit"), Command.stderr("inherit")),
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
