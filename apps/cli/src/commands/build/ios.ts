import path from "node:path";

import { Command, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import type { Scope } from "effect";

import { findIosArtifact } from "../../lib/artifact-finder";
import { downloadIosCredentials } from "../../lib/credentials-downloader";
import { ArtifactNotFoundError, BuildFailedError } from "../../lib/exit-codes";
import { renderExportOptionsPlist } from "../../lib/ios-export-options";
import { acquireKeychain } from "../../lib/ios-keychain";
import { installProvisioningProfile } from "../../lib/ios-provisioning";
import { loadLocalIosCredentials } from "../../lib/local-credentials";
import { validateIosBuild } from "../../lib/post-build-validation";
import { sha256File } from "../../lib/sha256";
import { createXcodebuildFormatter } from "../../lib/xcpretty-formatter";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep, runStepFormatted } from "./run-step";

import type { CredentialsSource, IosProfile } from "../../lib/build-profile";
import type {
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
  readonly credentialsSource: CredentialsSource;
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

type IosBuildRequiredServices =
  | CliRuntime
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | Scope.Scope;

type IosBuildErrors =
  | BuildFailedError
  | MissingCredentialsError
  | KeychainError
  | ProvisioningError
  | ArtifactNotFoundError
  | PlatformError;

const prebuildAndPods = (params: {
  readonly projectRoot: string;
  readonly iosDir: string;
  readonly commandEnv: Record<string, string>;
}) =>
  Effect.gen(function* () {
    yield* runStep(
      Command.make("bunx", "expo", "prebuild", "--platform", "ios", "--clean").pipe(
        Command.workingDirectory(params.projectRoot),
        Command.env(params.commandEnv),
      ),
      "expo prebuild ios",
    );
    yield* runStep(
      Command.make("pod", "install").pipe(
        Command.workingDirectory(params.iosDir),
        Command.env(params.commandEnv),
      ),
      "pod install",
    );
  });

const findAppDirectory = (
  root: string,
): Effect.Effect<string, ArtifactNotFoundError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stack = [root];
    let depth = 0;
    while (stack.length > 0 && depth < 6) {
      const layer = stack.splice(0);
      depth += 1;
      for (const dir of layer) {
        const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []));
        for (const entry of entries) {
          const full = path.join(dir, entry);
          if (entry.endsWith(".app")) {
            return full;
          }
          const stat = yield* fs.stat(full).pipe(Effect.option);
          if (stat._tag === "Some" && stat.value.type === "Directory") {
            stack.push(full);
          }
        }
      }
    }
    return yield* new ArtifactNotFoundError({
      message: `No .app bundle found under "${root}".`,
    });
  });

const runIosSimulatorBuild = (
  input: RunIosBuildInput,
): Effect.Effect<RunIosBuildResult, IosBuildErrors, IosBuildRequiredServices> =>
  Effect.gen(function* () {
    const { projectRoot, iosProfile, envVars, tempDir } = input;
    const runtime = yield* CliRuntime;
    const iosDir = path.join(projectRoot, "ios");
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    yield* prebuildAndPods({ projectRoot, iosDir, commandEnv });

    const workspaceFilename = yield* findXcworkspace(iosDir);
    const scheme = iosProfile.scheme ?? workspaceFilename.replace(/\.xcworkspace$/u, "");
    const configuration = iosProfile.buildConfiguration ?? "Release";
    const derivedDataPath = path.join(tempDir, "derived-data");

    const buildCmd = Command.make(
      "xcodebuild",
      "-workspace",
      workspaceFilename,
      "-scheme",
      scheme,
      "-configuration",
      configuration,
      "-sdk",
      "iphonesimulator",
      "-destination",
      "generic/platform=iOS Simulator",
      "-derivedDataPath",
      derivedDataPath,
      "build",
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "CODE_SIGN_IDENTITY=",
    ).pipe(Command.workingDirectory(iosDir), Command.env(commandEnv));

    const formatter = input.rawOutput ? undefined : createXcodebuildFormatter(projectRoot);
    yield* formatter
      ? runStepFormatted(buildCmd, "xcodebuild build (simulator)", formatter)
      : runStep(buildCmd, "xcodebuild build (simulator)");

    const productsRoot = path.join(
      derivedDataPath,
      "Build",
      "Products",
      `${configuration}-iphonesimulator`,
    );
    const appDir = yield* findAppDirectory(productsRoot);
    const archiveName = `${path.basename(appDir, ".app")}-simulator.tar.gz`;
    const archivePath = path.join(tempDir, archiveName);
    yield* runStep(
      Command.make(
        "tar",
        "-czf",
        archivePath,
        "-C",
        path.dirname(appDir),
        path.basename(appDir),
      ).pipe(Command.env(commandEnv)),
      "tar simulator .app",
    );

    const { sha256, byteSize } = yield* sha256File(archivePath);
    return { artifactPath: archivePath, byteSize, sha256 };
  });

const runIosDeviceBuild = (
  input: RunIosBuildInput,
): Effect.Effect<RunIosBuildResult, IosBuildErrors, IosBuildRequiredServices> =>
  // eslint-disable-next-line eslint/max-statements -- ios device build orchestration is inherently sequential (prebuild → pod → credentials → archive → exportArchive → find artifact → sha256); splitting further fragments the pipeline without clarifying it
  Effect.gen(function* () {
    const { api, tempDir, projectRoot, iosProfile, bundleId, envVars, projectId } = input;
    const runtime = yield* CliRuntime;

    const iosDir = path.join(projectRoot, "ios");
    const { distribution } = iosProfile;
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    const credentials =
      input.credentialsSource === "local"
        ? yield* loadLocalIosCredentials({ projectRoot })
        : yield* downloadIosCredentials(api, {
            projectId,
            bundleIdentifier: bundleId,
            distribution,
            tempDir,
          });

    yield* prebuildAndPods({ projectRoot, iosDir, commandEnv });

    const keychain = yield* acquireKeychain({
      tempDir,
      p12Path: credentials.p12Path,
      p12Password: credentials.p12Password,
    });

    const provisioning = yield* installProvisioningProfile({
      profilePath: credentials.profilePath,
    });

    const workspaceFilename = yield* findXcworkspace(iosDir);
    const scheme = iosProfile.scheme ?? workspaceFilename.replace(/\.xcworkspace$/u, "");
    const configuration = iosProfile.buildConfiguration ?? "Release";

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

    yield* validateIosBuild({
      archivePath,
      expectedBundleId: bundleId,
      expectedTeamId: provisioning.teamId,
      expectedProfileUuid: provisioning.uuid,
    });

    const artifactPath = yield* findIosArtifact({ exportPath });
    const { sha256, byteSize } = yield* sha256File(artifactPath);

    return { artifactPath, byteSize, sha256 };
  });

export const runIosBuild = (
  input: RunIosBuildInput,
): Effect.Effect<RunIosBuildResult, IosBuildErrors, IosBuildRequiredServices> =>
  input.iosProfile.simulator === true ? runIosSimulatorBuild(input) : runIosDeviceBuild(input);
