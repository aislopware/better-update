import { Prompt } from "@effect/cli";
import { Command, CommandExecutor } from "@effect/platform";
import { Effect, Redacted } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { BuildFailedError } from "./exit-codes";

const DEFAULT_KEYSTORE_VALIDITY_DAYS = 10_000;

const validateRequired = (label: string) => (value: string) =>
  value.trim().length > 0 ? Effect.succeed(value.trim()) : Effect.fail(`${label} is required.`);

export interface AndroidKeystorePromptDefaults {
  readonly credentialName?: string;
  readonly keyAlias?: string;
  readonly storePassword?: string;
  readonly keyPassword?: string;
  readonly commonName?: string;
  readonly organization?: string;
}

export interface AndroidKeystorePromptResult {
  readonly credentialName: string;
  readonly keyAlias: string;
  readonly storePassword: string;
  readonly keyPassword: string;
  readonly commonName: string;
  readonly organization: string;
}

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

export const promptAndroidKeystoreDetails = (defaults: AndroidKeystorePromptDefaults = {}) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const userName = yield* runtime.userName;
    const credentialName = yield* Prompt.text({
      message: "Credential name:",
      default: defaults.credentialName ?? "Release Keystore",
      validate: validateRequired("Credential name"),
    });
    const keyAlias = yield* Prompt.text({
      message: "Key alias:",
      default: defaults.keyAlias ?? "release-key",
      validate: validateRequired("Key alias"),
    });
    const storePassword =
      defaults.storePassword ??
      Redacted.value(
        yield* Prompt.password({
          message: "Keystore password:",
          validate: validateRequired("Keystore password"),
        }),
      );
    const rawKeyPassword =
      defaults.keyPassword ??
      Redacted.value(
        yield* Prompt.password({
          message: "Key password (leave blank to reuse keystore password):",
        }),
      );
    const commonName = yield* Prompt.text({
      message: "Your name (CN):",
      default: defaults.commonName ?? userName,
      validate: validateRequired("Common name"),
    });
    const organization = yield* Prompt.text({
      message: "Organization (O):",
      default: defaults.organization ?? "better-update",
      validate: validateRequired("Organization"),
    });

    return {
      credentialName,
      keyAlias,
      storePassword,
      keyPassword: rawKeyPassword.trim().length > 0 ? rawKeyPassword : storePassword,
      commonName,
      organization,
    };
  });

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
