import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { ensureIosCredentials } from "../../application/credentials-interactive";
import { findArtifactByGlob, findIosArtifact } from "../../lib/artifact-finder";
import { downloadIosCredentials } from "../../lib/credentials-downloader";
import { BuildFailedError, MissingCredentialsError, ProvisioningError } from "../../lib/exit-codes";
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
import { findAppDirectory, prepareIosNative, resolveXcodeContainer } from "./ios-prepare";
import { runStep, runStepFormatted } from "./run-step";

import type { CredentialsSource, IosProfile } from "../../lib/build-profile";
import type { IosBuildStrategy } from "../../lib/build-strategy";
import type { IosCredentialProfile, IosCredentials } from "../../lib/credentials-downloader";
import type { CustomCommandSpec } from "../../lib/eas-config";
import type { TargetSigningEntry } from "../../lib/ios-codesign-pbxproj";
import type { DiscoveredTarget } from "../../lib/xcode-targets";
import type { ApiClient } from "../../services/api-client";
import type { RunStepCommand } from "./run-step";

export interface RunIosBuildInput {
  readonly api: ApiClient;
  readonly tempDir: string;
  readonly projectRoot: string;
  readonly iosProfile: IosProfile;
  readonly bundleId: string;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly credentialsSource: CredentialsSource;
  /** How to produce the artifact (prebuild+xcodebuild / xcodebuild / custom). */
  readonly strategy: IosBuildStrategy;
  /** Custom build command, required when `strategy === "custom"`. */
  readonly customCommand?: CustomCommandSpec;
  readonly rawOutput?: boolean | undefined;
  readonly freezeCredentials?: boolean | undefined;
  /** OTA channel baked into Expo.plist after prebuild; undefined skips injection. */
  readonly updateChannel?: string | undefined;
}

const runIosSimulatorBuild = (input: RunIosBuildInput) =>
  Effect.gen(function* () {
    const { projectRoot, iosProfile, envVars, tempDir } = input;
    const runtime = yield* CliRuntime;
    const iosDir = path.join(projectRoot, "ios");
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    yield* prepareIosNative({
      strategy: input.strategy,
      projectRoot,
      iosDir,
      iosProfile,
      commandEnv,
      updateChannel: input.updateChannel,
    });

    const container = yield* resolveXcodeContainer(projectRoot, iosDir, iosProfile);
    const scheme = iosProfile.scheme ?? container.schemeBase;
    const configuration = iosProfile.buildConfiguration ?? "Release";
    const derivedDataPath = path.join(tempDir, "derived-data");

    const buildCmd: RunStepCommand = {
      command: "xcodebuild",
      args: [
        container.flag,
        container.containerPath,
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
      ],
      cwd: iosDir,
      env: commandEnv,
    };

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
      {
        command: "tar",
        args: ["-czf", archivePath, "-C", path.dirname(appDir), path.basename(appDir)],
        cwd: projectRoot,
        env: commandEnv,
      },
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
  // eslint-disable-next-line eslint/max-statements -- ios device build orchestration is inherently sequential (prepare → discover targets → credentials → keychain → install profiles → mutate pbxproj → archive → exportArchive → validate → artifact)
  Effect.gen(function* () {
    const { api, tempDir, projectRoot, iosProfile, envVars } = input;
    const runtime = yield* CliRuntime;
    const fs = yield* FileSystem.FileSystem;

    const iosDir = path.join(projectRoot, "ios");
    const { distribution } = iosProfile;
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    yield* prepareIosNative({
      strategy: input.strategy,
      projectRoot,
      iosDir,
      iosProfile,
      commandEnv,
      updateChannel: input.updateChannel,
    });

    const container = yield* resolveXcodeContainer(projectRoot, iosDir, iosProfile);
    const scheme = iosProfile.scheme ?? container.schemeBase;
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
    const archiveCmd: RunStepCommand = {
      command: "xcodebuild",
      args: [
        container.flag,
        container.containerPath,
        "-scheme",
        scheme,
        "-configuration",
        configuration,
        "-archivePath",
        archivePath,
        "-allowProvisioningUpdates",
        "archive",
      ],
      cwd: iosDir,
      env: commandEnv,
    };

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
    const exportCmd: RunStepCommand = {
      command: "xcodebuild",
      args: [
        "-exportArchive",
        "-archivePath",
        archivePath,
        "-exportPath",
        exportPath,
        "-exportOptionsPlist",
        exportOptionsPath,
        "-allowProvisioningUpdates",
      ],
      cwd: iosDir,
      env: commandEnv,
    };

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

/**
 * Custom-command iOS build. The resolved p12 + provisioning profiles are written
 * to `tempDir` and their paths exposed via `BETTER_UPDATE_IOS_*` env vars; the
 * user's command performs the actual signing/archive. The artifact is located
 * via the profile's `artifactPath` glob.
 */
const runIosCustom = (input: RunIosBuildInput) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const commandEnv = yield* runtime.commandEnvironment(input.envVars);
    const custom = input.customCommand;
    if (custom === undefined) {
      return yield* new BuildFailedError({
        step: "custom ios build",
        exitCode: 1,
        message: "Internal: custom iOS strategy selected without a custom command.",
      });
    }
    if (custom.artifactPath === undefined) {
      return yield* new BuildFailedError({
        step: "custom ios build",
        exitCode: 1,
        message: 'Custom iOS build requires "artifactPath" (e.g. "build/*.ipa") in eas.json.',
      });
    }

    const credentials = yield* fetchAllCredentials({
      api: input.api,
      input,
      mainBundleIdentifier: input.bundleId,
      allBundleIdentifiers: [input.bundleId],
    });
    const credEnv = {
      BETTER_UPDATE_IOS_P12_PATH: credentials.p12Path,
      BETTER_UPDATE_IOS_P12_PASSWORD: credentials.p12Password,
      BETTER_UPDATE_IOS_PROVISIONING_PROFILES: credentials.profiles
        .map((profile) => profile.profilePath)
        .join(":"),
    };
    const cwd =
      custom.cwd === undefined ? input.projectRoot : path.join(input.projectRoot, custom.cwd);
    const buildStartMs = Date.now();

    yield* runStep(
      {
        command: "sh",
        args: ["-c", custom.command],
        cwd,
        env: { ...commandEnv, ...credEnv, ...custom.env },
      },
      "custom ios build",
    );

    const artifactPath = yield* findArtifactByGlob({
      baseDir: cwd,
      pattern: custom.artifactPath,
      minMtimeMs: buildStartMs,
    });
    const { sha256, byteSize } = yield* sha256File(artifactPath);
    return { artifactPath, byteSize, sha256 };
  });

export const runIosBuild = (input: RunIosBuildInput) => {
  if (input.strategy === "custom") {
    return runIosCustom(input);
  }
  return input.iosProfile.simulator === true
    ? runIosSimulatorBuild(input)
    : runIosDeviceBuild(input);
};
