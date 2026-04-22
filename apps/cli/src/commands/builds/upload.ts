import { Args, Command, Options } from "@effect/cli";
import { Effect, Option } from "effect";

import { exitWith } from "../../application/command-exit";
import { runUploadWorkflow } from "../../application/upload-workflow";

import type {
  ArtifactNotFoundError,
  AuthRequiredError,
  BuildFailedError,
  BuildProfileError,
  CompleteError,
  EnvExportError,
  PresignedUrlExpiredError,
  ProjectNotLinkedError,
  ReserveError,
  RuntimeVersionError,
  UploadFailedError,
} from "../../lib/exit-codes";

const artifactPath = Args.text({ name: "artifact-path" });
const platform = Options.choice("platform", ["ios", "android"] as const);
const profile = Options.text("profile").pipe(Options.withDefault("production"));
const message = Options.text("message").pipe(Options.optional);

export const uploadCommand = Command.make(
  "upload",
  { artifactPath, platform, profile, message },
  (opts) =>
    runUploadWorkflow({
      artifactPath: opts.artifactPath,
      platform: opts.platform,
      profileName: opts.profile,
      message: Option.getOrUndefined(opts.message),
    }).pipe(
      Effect.catchTags({
        AuthRequiredError: (err: AuthRequiredError) => exitWith(3, err.message),
        ProjectNotLinkedError: (err: ProjectNotLinkedError) => exitWith(4, err.message),
        BuildProfileError: (err: BuildProfileError) => exitWith(2, err.message),
        RuntimeVersionError: (err: RuntimeVersionError) => exitWith(2, err.message),
        ArtifactNotFoundError: (err: ArtifactNotFoundError) => exitWith(6, err.message),
        BuildFailedError: (err: BuildFailedError) => exitWith(6, err.message),
        ReserveError: (err: ReserveError) => exitWith(7, err.message),
        UploadFailedError: (err: UploadFailedError) => exitWith(7, err.message),
        PresignedUrlExpiredError: (err: PresignedUrlExpiredError) => exitWith(7, err.message),
        CompleteError: (err: CompleteError) => exitWith(7, err.message),
        EnvExportError: (err: EnvExportError) => exitWith(7, err.message),
      }),
    ),
);
