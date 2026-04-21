import { Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import type { BadArgument, SystemError } from "@effect/platform/Error";

import { runBuildWorkflow } from "../../application/build-workflow";
import { exitWith } from "../../application/command-exit";

import type {
  ArtifactNotFoundError,
  AuthRequiredError,
  BuildFailedError,
  BuildProfileError,
  CompleteError,
  EnvExportError,
  KeychainError,
  MissingCredentialsError,
  PresignedUrlExpiredError,
  ProjectNotLinkedError,
  ProvisioningError,
  ReserveError,
  RuntimeVersionError,
  UploadFailedError,
} from "../../lib/exit-codes";

const platform = Options.choice("platform", ["ios", "android"] as const);
const profile = Options.text("profile").pipe(Options.withDefault("production"));
const message = Options.text("message").pipe(Options.optional);
const noUpload = Options.boolean("no-upload");
const rawOutput = Options.boolean("raw-output");

export const buildCommand = Command.make(
  "build",
  { platform, profile, message, noUpload, rawOutput },
  (opts) =>
    runBuildWorkflow({
      platform: opts.platform,
      profileName: opts.profile,
      message: Option.getOrUndefined(opts.message),
      noUpload: opts.noUpload,
      rawOutput: opts.rawOutput,
    }).pipe(
      Effect.catchTags({
        AuthRequiredError: (err: AuthRequiredError) => exitWith(3, err.message),
        ProjectNotLinkedError: (err: ProjectNotLinkedError) => exitWith(4, err.message),
        BuildProfileError: (err: BuildProfileError) => exitWith(2, err.message),
        RuntimeVersionError: (err: RuntimeVersionError) => exitWith(2, err.message),
        MissingCredentialsError: (err: MissingCredentialsError) =>
          exitWith(5, `${err.message}\n${err.hint}`),
        BuildFailedError: (err: BuildFailedError) => exitWith(6, err.message),
        KeychainError: (err: KeychainError) => exitWith(6, err.message),
        ProvisioningError: (err: ProvisioningError) => exitWith(6, err.message),
        ArtifactNotFoundError: (err: ArtifactNotFoundError) => exitWith(6, err.message),
        ReserveError: (err: ReserveError) => exitWith(7, err.message),
        UploadFailedError: (err: UploadFailedError) => exitWith(7, err.message),
        PresignedUrlExpiredError: (err: PresignedUrlExpiredError) => exitWith(7, err.message),
        CompleteError: (err: CompleteError) => exitWith(7, err.message),
        EnvExportError: (err: EnvExportError) => exitWith(7, err.message),
        SystemError: (err: SystemError) => exitWith(6, `Filesystem error: ${err.message}`),
        BadArgument: (err: BadArgument) => exitWith(6, `Invalid argument: ${err.message}`),
      }),
    ),
);
