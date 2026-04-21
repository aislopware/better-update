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
