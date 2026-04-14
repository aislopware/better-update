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

export const buildCommand = Command.make(
  "build",
  { platform, profile, message, noUpload },
  (opts) =>
    runBuildWorkflow({
      platform: opts.platform,
      profileName: opts.profile,
      message: Option.getOrUndefined(opts.message),
      noUpload: opts.noUpload,
    }).pipe(
      Effect.catchTags({
        AuthRequiredError: (e: AuthRequiredError) => exitWith(3, e.message),
        ProjectNotLinkedError: (e: ProjectNotLinkedError) => exitWith(4, e.message),
        BuildProfileError: (e: BuildProfileError) => exitWith(2, e.message),
        RuntimeVersionError: (e: RuntimeVersionError) => exitWith(2, e.message),
        MissingCredentialsError: (e: MissingCredentialsError) =>
          exitWith(5, `${e.message}\n${e.hint}`),
        BuildFailedError: (e: BuildFailedError) => exitWith(6, e.message),
        KeychainError: (e: KeychainError) => exitWith(6, e.message),
        ProvisioningError: (e: ProvisioningError) => exitWith(6, e.message),
        ArtifactNotFoundError: (e: ArtifactNotFoundError) => exitWith(6, e.message),
        ReserveError: (e: ReserveError) => exitWith(7, e.message),
        UploadFailedError: (e: UploadFailedError) => exitWith(7, e.message),
        PresignedUrlExpiredError: (e: PresignedUrlExpiredError) => exitWith(7, e.message),
        CompleteError: (e: CompleteError) => exitWith(7, e.message),
        EnvExportError: (e: EnvExportError) => exitWith(7, e.message),
        SystemError: (e: SystemError) => exitWith(6, `Filesystem error: ${e.message}`),
        BadArgument: (e: BadArgument) => exitWith(6, `Invalid argument: ${e.message}`),
      }),
    ),
);
