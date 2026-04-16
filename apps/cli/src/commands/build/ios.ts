import path from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Effect, Scope } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { findIosArtifact } from "../../lib/artifact-finder";
import { downloadIosCredentials } from "../../lib/credentials-downloader";
import { BuildFailedError } from "../../lib/exit-codes";
import { renderExportOptionsPlist } from "../../lib/ios-export-options";
import { acquireKeychain } from "../../lib/ios-keychain";
import { installProvisioningProfile } from "../../lib/ios-provisioning";
import { validateIosBuild } from "../../lib/post-build-validation";
import { sha256File } from "../../lib/sha256";
import { createXcodebuildFormatter } from "../../lib/xcpretty-formatter";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep, runStepFormatted } from "./run-step";

import type { IosProfile } from "../../lib/build-profile";
import type {
  ArtifactNotFoundError,
  KeychainError,
  MissingCredentialsError,
  ProvisioningError,
} from "../../lib/exit-codes";
import type { ApiClient } from "../../services/api-client";

export interface RunIosBuildInput {
  readonly api: ApiClient;
  readonly tempDir: string;
  readonly projectRoot: string;
  readonly iosProfile: IosProfile;
  readonly bundleId: string;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly rawOutput?: boolean | undefined;
}

export interface RunIosBuildResult {
  readonly artifactPath: string;
  readonly byteSize: number;
  readonly sha256: string;
}

const findXcworkspace = (
  iosDir: string,
): Effect.Effect<string, BuildFailedError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(iosDir);
    const workspace = entries.find((entry) => entry.endsWith(".xcworkspace"));
    if (!workspace) {
      return yield* new BuildFailedError({
        step: "detect xcworkspace",
        exitCode: 1,
        message: `No .xcworkspace found under ${iosDir}. Did "pod install" run?`,
      });
    }
    return workspace;
  });

export const runIosBuild = (
  input: RunIosBuildInput,
): Effect.Effect<
  RunIosBuildResult,
  | BuildFailedError
  | MissingCredentialsError
  | KeychainError
  | ProvisioningError
  | ArtifactNotFoundError
  | PlatformError,
  CliRuntime | CommandExecutor.CommandExecutor | FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    const { api, tempDir, projectRoot, iosProfile, bundleId, envVars, projectId } = input;
    const runtime = yield* CliRuntime;

    const iosDir = path.join(projectRoot, "ios");
    const distribution = iosProfile.distribution;
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    // 1. Download credentials (p12 + mobileprovision) into tempDir.
    const credentials = yield* downloadIosCredentials(api, {
      projectId,
      distribution,
      tempDir,
    });

    // 2. Expo prebuild (ios).
    yield* runStep(
      Command.make("bunx", "expo", "prebuild", "--platform", "ios", "--clean").pipe(
        Command.workingDirectory(projectRoot),
        Command.env(commandEnv),
      ),
      "expo prebuild ios",
    );

    // 3. pod install.
    yield* runStep(
      Command.make("pod", "install").pipe(
        Command.workingDirectory(iosDir),
        Command.env(commandEnv),
      ),
      "pod install",
    );

    // 4. Scoped ephemeral keychain (auto-cleaned on scope close).
    const keychain = yield* acquireKeychain({
      tempDir,
      p12Path: credentials.p12Path,
      p12Password: credentials.p12Password,
    });

    // 5. Scoped provisioning profile install.
    const provisioning = yield* installProvisioningProfile({
      profilePath: credentials.profilePath,
    });

    // 6. Detect workspace + scheme.
    const workspaceFilename = yield* findXcworkspace(iosDir);
    const scheme = iosProfile.scheme ?? workspaceFilename.replace(/\.xcworkspace$/, "");
    const configuration = iosProfile.buildConfiguration ?? "Release";

    // 7. xcodebuild archive.
    const archivePath = path.join(tempDir, "build.xcarchive");
    const archiveCmd = Command.make(
      "xcodebuild",
      "-workspace",
      workspaceFilename,
      "-scheme",
      scheme,
      "-configuration",
      configuration,
      "-archivePath",
      archivePath,
      "-allowProvisioningUpdates",
      "archive",
      "CODE_SIGN_STYLE=Manual",
      `DEVELOPMENT_TEAM=${provisioning.teamId}`,
      `CODE_SIGN_IDENTITY=${keychain.signingIdentity}`,
      `PROVISIONING_PROFILE_SPECIFIER=${provisioning.name}`,
    ).pipe(Command.workingDirectory(iosDir), Command.env(commandEnv));

    const formatter = input.rawOutput ? undefined : createXcodebuildFormatter(projectRoot);
    yield* formatter
      ? runStepFormatted(archiveCmd, "xcodebuild archive", formatter)
      : runStep(archiveCmd, "xcodebuild archive");

    const fs = yield* FileSystem.FileSystem;
    const exportOptionsPath = path.join(tempDir, "ExportOptions.plist");
    yield* fs.writeFileString(
      exportOptionsPath,
      renderExportOptionsPlist({
        method: distribution,
        teamId: provisioning.teamId,
        bundleId,
        provisioningProfileName: provisioning.name,
      }),
    );

    // 9. xcodebuild exportArchive.
    const exportPath = path.join(tempDir, "export");
    const exportCmd = Command.make(
      "xcodebuild",
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      exportOptionsPath,
      "-allowProvisioningUpdates",
    ).pipe(Command.workingDirectory(iosDir), Command.env(commandEnv));

    yield* formatter
      ? runStepFormatted(exportCmd, "xcodebuild exportArchive", formatter)
      : runStep(exportCmd, "xcodebuild exportArchive");

    // 10. Post-build validation (non-blocking).
    yield* validateIosBuild({
      archivePath,
      expectedBundleId: bundleId,
      expectedTeamId: provisioning.teamId,
      expectedProfileUuid: provisioning.uuid,
    });

    // 11. Locate artifact.
    const artifactPath = yield* findIosArtifact({ exportPath });

    // 12. SHA-256 + byte size.
    const { sha256, byteSize } = yield* sha256File(artifactPath);

    return { artifactPath, byteSize, sha256 };
  });
