import process from "node:process";

import { Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";

import { runBuildOrchestrator } from "./orchestrator";

const platform = Options.choice("platform", ["ios", "android"] as const);
const profile = Options.text("profile").pipe(Options.withDefault("production"));
const message = Options.text("message").pipe(Options.optional);
const noUpload = Options.boolean("no-upload");

// Returns `void` (not `never`): the handler catches the error, logs it, and
// sets `process.exitCode` so BunRuntime exits with the right code AFTER scope
// finalizers (keychain, provisioning profile, temp dir with signing secrets)
// have run. Using `process.exit` here would terminate synchronously and skip
// those finalizers, leaking credentials to disk on any failed build.
const exitWith = (code: number, msg: string): Effect.Effect<void> =>
  Console.error(msg).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
  );

export const buildCommand = Command.make(
  "build",
  { platform, profile, message, noUpload },
  (opts) =>
    runBuildOrchestrator({
      platform: opts.platform,
      profileName: opts.profile,
      message: Option.getOrUndefined(opts.message),
      noUpload: opts.noUpload,
    }).pipe(
      Effect.catchTags({
        AuthRequiredError: (e) => exitWith(3, e.message),
        ProjectNotLinkedError: (e) => exitWith(4, e.message),
        BuildProfileError: (e) => exitWith(2, e.message),
        RuntimeVersionError: (e) => exitWith(2, e.message),
        MissingCredentialsError: (e) => exitWith(5, `${e.message}\n${e.hint}`),
        BuildFailedError: (e) => exitWith(6, e.message),
        KeychainError: (e) => exitWith(6, e.message),
        ProvisioningError: (e) => exitWith(6, e.message),
        ArtifactNotFoundError: (e) => exitWith(6, e.message),
        ReserveError: (e) => exitWith(7, e.message),
        UploadFailedError: (e) => exitWith(7, e.message),
        PresignedUrlExpiredError: (e) => exitWith(7, e.message),
        CompleteError: (e) => exitWith(7, e.message),
        EnvExportError: (e) => exitWith(7, e.message),
        SystemError: (e) => exitWith(6, `Filesystem error: ${e.message}`),
        BadArgument: (e) => exitWith(6, `Invalid argument: ${e.message}`),
      }),
    ),
);
