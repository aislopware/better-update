import path from "node:path";

import { Command, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { ensureIosCredentials } from "../../application/credentials-interactive";
import { findIosArtifact } from "../../lib/artifact-finder";
import { downloadIosCredentials } from "../../lib/credentials-downloader";
import {
  ArtifactNotFoundError,
  BuildFailedError,
  MissingCredentialsError,
  ProvisioningError,
} from "../../lib/exit-codes";
import { applyTargetSigning } from "../../lib/ios-codesign-pbxproj";
import { renderExportOptionsPlist } from "../../lib/ios-export-options";
import { acquireKeychain } from "../../lib/ios-keychain";
import { installProvisioningProfile } from "../../lib/ios-provisioning";
import { loadLocalIosCredentials } from "../../lib/local-credentials";
import { validateIosBuild } from "../../lib/post-build-validation";
import { sha256File } from "../../lib/sha256";
import { discoverSignedTargets } from "../../lib/xcode-targets";
import { createXcodebuildFormatter } from "../../lib/xcpretty-formatter";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep, runStepFormatted } from "./run-step";

import type { CredentialsSource, IosProfile } from "../../lib/build-profile";
import type { IosCredentialProfile, IosCredentials } from "../../lib/credentials-downloader";
import type { TargetSigningEntry } from "../../lib/ios-codesign-pbxproj";
import type { DiscoveredTarget } from "../../lib/xcode-targets";
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
  readonly freezeCredentials?: boolean | undefined;
}

const findXcworkspace = (iosDir: string) =>
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

const findAppDirectory = (root: string) =>
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

const runIosSimulatorBuild = (input: RunIosBuildInput) =>
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

// ── multi-target credentials + signing helpers ────────────────────

// Sequential so interactive Apple ID / ASC prompts don't race when multiple
// bundles (main + extensions) need setup in the same session.
const ensurePerTargetCredentials = (params: {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly distribution: IosProfile["distribution"];
  readonly signedTargets: readonly DiscoveredTarget[];
  readonly freezeCredentials: boolean;
}) =>
  Effect.forEach(
    params.signedTargets,
    (target) =>
      ensureIosCredentials(
        params.api,
        {
          projectId: params.projectId,
          bundleIdentifier: target.bundleId,
          distribution: params.distribution,
        },
        { freezeCredentials: params.freezeCredentials },
      ),
    { concurrency: 1 },
  );

const fetchAllCredentials = (params: {
  readonly api: ApiClient;
  readonly input: RunIosBuildInput;
  readonly mainBundleIdentifier: string;
  readonly allBundleIdentifiers: readonly string[];
}) =>
  params.input.credentialsSource === "local"
    ? loadLocalIosCredentials({
        projectRoot: params.input.projectRoot,
        mainBundleIdentifier: params.mainBundleIdentifier,
      })
    : downloadIosCredentials(params.api, {
        projectId: params.input.projectId,
        mainBundleIdentifier: params.mainBundleIdentifier,
        bundleIdentifiers: params.allBundleIdentifiers,
        distribution: params.input.iosProfile.distribution,
        tempDir: params.input.tempDir,
      });

const installPerTarget = (
  signedTargets: readonly DiscoveredTarget[],
  credentials: IosCredentials,
  credentialsSource: CredentialsSource,
) =>
  Effect.gen(function* () {
    const profileByBundle = new Map(
      credentials.profiles.map((profile) => [profile.bundleIdentifier, profile]),
    );
    const missing = signedTargets.filter((target) => !profileByBundle.has(target.bundleId));
    if (missing.length > 0) {
      const list = missing
        .map((target) => `"${target.targetName}" (${target.bundleId})`)
        .join(", ");
      const hint =
        credentialsSource === "local"
          ? "Add the missing entries to credentials.json under ios.additionalProvisioningProfiles."
          : "Register the bundle identifier(s) in the dashboard and bind a provisioning profile.";
      return yield* new MissingCredentialsError({
        message: `Missing provisioning profile for signed target(s): ${list}.`,
        hint,
      });
    }

    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(array, callback) is not Array.prototype.forEach
    return yield* Effect.forEach(signedTargets, (target) =>
      installProfileForTarget(target, profileByBundle),
    );
  });

const installProfileForTarget = (
  target: DiscoveredTarget,
  profileByBundle: ReadonlyMap<string, IosCredentialProfile>,
) => {
  const profile = profileByBundle.get(target.bundleId);
  if (!profile) {
    // Unreachable — guarded by the caller's pre-check; keep narrowing here for the type checker.
    return Effect.fail(
      new ProvisioningError({
        message: `Internal: no profile for ${target.bundleId} after pre-check.`,
      }),
    );
  }
  return installProvisioningProfile({ profilePath: profile.profilePath }).pipe(
    Effect.map((installed) => ({ target, profile, installed })),
  );
};

const pickMainTarget = (signedTargets: readonly DiscoveredTarget[]): DiscoveredTarget | undefined =>
  signedTargets.find((target) => target.productType === "com.apple.product-type.application") ??
  signedTargets[0];

const runIosDeviceBuild = (input: RunIosBuildInput) =>
  // eslint-disable-next-line eslint/max-statements -- ios device build orchestration is inherently sequential (prebuild → pods → discover targets → credentials → keychain → install profiles → mutate pbxproj → archive → exportArchive → validate → artifact)
  Effect.gen(function* () {
    const { api, tempDir, projectRoot, iosProfile, envVars } = input;
    const runtime = yield* CliRuntime;
    const fs = yield* FileSystem.FileSystem;

    const iosDir = path.join(projectRoot, "ios");
    const { distribution } = iosProfile;
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    yield* prebuildAndPods({ projectRoot, iosDir, commandEnv });

    const workspaceFilename = yield* findXcworkspace(iosDir);
    const scheme = iosProfile.scheme ?? workspaceFilename.replace(/\.xcworkspace$/u, "");
    const configuration = iosProfile.buildConfiguration ?? "Release";

    const signedTargets = yield* discoverSignedTargets({
      iosDir,
      configurationName: configuration,
    });

    const mainTarget = pickMainTarget(signedTargets);
    if (!mainTarget) {
      return yield* new BuildFailedError({
        step: "discover signed targets",
        exitCode: 1,
        message: `No signed iOS targets found in the Xcode project for configuration "${configuration}".`,
      });
    }

    if (input.credentialsSource === "remote") {
      yield* ensurePerTargetCredentials({
        api,
        projectId: input.projectId,
        distribution: iosProfile.distribution,
        signedTargets,
        freezeCredentials: input.freezeCredentials ?? false,
      });
    }

    const credentials = yield* fetchAllCredentials({
      api,
      input,
      mainBundleIdentifier: mainTarget.bundleId,
      allBundleIdentifiers: signedTargets.map((target) => target.bundleId),
    });

    const keychain = yield* acquireKeychain({
      tempDir,
      p12Path: credentials.p12Path,
      p12Password: credentials.p12Password,
    });

    const installedTargets = yield* installPerTarget(
      signedTargets,
      credentials,
      input.credentialsSource,
    );

    const signingEntries: readonly TargetSigningEntry[] = installedTargets.map(
      ({ target, installed }) => ({
        targetName: target.targetName,
        buildConfigurationUuids: target.buildConfigurationUuids,
        settings: {
          teamId: installed.teamId,
          signingIdentity: keychain.signingIdentity,
          profileSpecifier: installed.name,
        },
      }),
    );

    yield* applyTargetSigning({ iosDir, entries: signingEntries });

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
    ).pipe(Command.workingDirectory(iosDir), Command.env(commandEnv));

    const formatter = input.rawOutput ? undefined : createXcodebuildFormatter(projectRoot);
    yield* formatter
      ? runStepFormatted(archiveCmd, "xcodebuild archive", formatter)
      : runStep(archiveCmd, "xcodebuild archive");

    const exportOptionsPath = path.join(tempDir, "ExportOptions.plist");
    const mainInstall = installedTargets.find(
      (entry) => entry.target.targetName === mainTarget.targetName,
    );
    if (!mainInstall) {
      return yield* new BuildFailedError({
        step: "resolve main target signing",
        exitCode: 1,
        message: `Internal: main target "${mainTarget.targetName}" was not in the installed list.`,
      });
    }
    const { teamId } = mainInstall.installed;

    yield* fs.writeFileString(
      exportOptionsPath,
      renderExportOptionsPlist({
        method: distribution,
        teamId,
        provisioningProfiles: installedTargets.map(({ target, installed }) => ({
          bundleId: target.bundleId,
          profileName: installed.name,
        })),
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
      expectedTeamId: teamId,
      expectedTargets: installedTargets.map(({ target, installed }) => ({
        bundleId: target.bundleId,
        profileUuid: installed.uuid,
      })),
    });

    const artifactPath = yield* findIosArtifact({ exportPath });
    const { sha256, byteSize } = yield* sha256File(artifactPath);

    return { artifactPath, byteSize, sha256 };
  });

export const runIosBuild = (input: RunIosBuildInput) =>
  input.iosProfile.simulator === true ? runIosSimulatorBuild(input) : runIosDeviceBuild(input);
