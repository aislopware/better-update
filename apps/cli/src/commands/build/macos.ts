/**
 * The native half of `build --platform macos`: produce a Developer ID-signed
 * `.app` (or a container a custom tool already packaged). Packaging,
 * notarization and upload are the workflow's — they are the same for every
 * strategy.
 *
 * - `xcode`  — archive the committed project with the vault identity forced
 *   onto every target (manual signing, hardened runtime on), then
 *   `-exportArchive` with `method=developer-id`, which re-signs nested code and
 *   strips `get-task-allow`. A "Generic Xcode Archive" (some target installs
 *   outside the app) cannot be exported; its app is signed by the CLI instead.
 * - `custom` — run the user's command with the identity exposed through the
 *   variables each desktop toolchain reads, then pick up what it produced.
 */
import path from "node:path";

import { asRecord, compact } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import { findArtifactByGlob, findBundleByGlob } from "../../lib/artifact-finder";
import { runBuildHook } from "../../lib/build-hooks";
import { BuildFailedError } from "../../lib/exit-codes";
import { renderExportOptionsPlist } from "../../lib/ios-export-options";
import { signMacosApp } from "../../lib/macos-signing";
import { prepareXcodeProfiles } from "../../lib/macos-xcode-profiles";
import { printHuman } from "../../lib/output";
import { parsePlist } from "../../lib/plist";
import { printWarn } from "../../lib/warning-style";
import { createXcodebuildFormatter } from "../../lib/xcpretty-formatter";
import { CliRuntime } from "../../services/cli-runtime";
import { collectIosDebugArtifacts } from "./ios-debug-artifacts";
import { findAppDirectory, podInstallSteps, resolveXcodeContainer } from "./ios-prepare";
import { runStep, runStepFormatted } from "./run-step";

import type { ResolvedProfile } from "../../application/macos-provisioning";
import type { DeveloperIdIdentity } from "../../application/macos-signing-identity";
import type { MacosProfile } from "../../lib/build-profile";
import type { MacosBuildStrategy } from "../../lib/build-strategy";
import type { CapturedDebugArtifact } from "../../lib/debug-artifacts";
import type { CustomCommandSpec } from "../../lib/eas-config";
import type { MacosPackageFormat } from "../../lib/macos-packaging";
import type { ResolveProfiles } from "../../lib/macos-xcode-profiles";
import type { PackageManager } from "../../lib/project-staging";
import type { RunStepCommand } from "./run-step";

export interface RunMacosBuildInput<ProfileError = never, ProfileServices = never> {
  readonly tempDir: string;
  readonly projectRoot: string;
  readonly macosProfile: MacosProfile;
  readonly strategy: MacosBuildStrategy;
  readonly customCommand: CustomCommandSpec | undefined;
  readonly envVars: Record<string, string>;
  readonly packageManager: PackageManager;
  readonly rawOutput: boolean | undefined;
  /** The Developer ID Application identity, already in an ephemeral keychain. */
  readonly identity: DeveloperIdIdentity;
  /** Profiles for Xcode targets claiming entitlements only a profile authorizes. */
  readonly resolveProfiles: ResolveProfiles<ProfileError, ProfileServices>;
}

export type MacosBuildProduct =
  | {
      readonly kind: "app";
      readonly path: string;
      readonly debugArtifacts: readonly CapturedDebugArtifact[];
    }
  | {
      readonly kind: "container";
      readonly path: string;
      readonly format: MacosPackageFormat;
      readonly debugArtifacts: readonly CapturedDebugArtifact[];
    };

const exists = (target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false));
  });

/**
 * Where the macOS Xcode project lives: next to an explicit workspace/project,
 * else `macos/` (react-native-macos, Flutter), else the project root (a plain
 * AppKit/SwiftUI repo).
 */
const resolveMacosDir = (projectRoot: string, profile: MacosProfile) =>
  Effect.gen(function* () {
    const explicit = profile.workspace ?? profile.project;
    if (explicit !== undefined) {
      return path.dirname(path.resolve(projectRoot, explicit));
    }
    const conventional = path.join(projectRoot, "macos");
    return (yield* exists(conventional)) ? conventional : projectRoot;
  });

const installPods = (params: {
  readonly projectRoot: string;
  readonly macosDir: string;
  readonly profile: MacosProfile;
  readonly env: Record<string, string>;
}) =>
  Effect.gen(function* () {
    if (params.profile.podInstall === false) {
      return;
    }
    if (!(yield* exists(path.join(params.macosDir, "Podfile")))) {
      return;
    }
    const steps = podInstallSteps({
      projectRoot: params.projectRoot,
      iosDir: params.macosDir,
      hasGemfile: yield* exists(path.join(params.projectRoot, "Gemfile")),
      // CocoaPods aborts on a non-UTF-8 locale.
      env: { ...params.env, LANG: "en_US.UTF-8" },
    });
    yield* Effect.forEach(steps, (step) => runStep(step.command, step.name), { discard: true });
  });

/**
 * Build settings forced onto every target from the command line. Manual
 * signing with the vault identity, no profile (Developer ID needs none unless
 * the app uses restricted entitlements), the hardened runtime the notary
 * requires — `-exportArchive` keeps each item's runtime flag rather than
 * adding it — and `--keychain` so codesign never wanders into another
 * keychain holding the same certificate.
 */
export const macosArchiveSettings = (params: {
  readonly identity: Pick<DeveloperIdIdentity, "name" | "teamId" | "keychainPath">;
  readonly universal: boolean;
  /** Profiles are selected per target in the project; a command-line value would override them all. */
  readonly perTargetProfiles?: boolean;
}): readonly string[] => [
  "CODE_SIGN_STYLE=Manual",
  `DEVELOPMENT_TEAM=${params.identity.teamId}`,
  `CODE_SIGN_IDENTITY=${params.identity.name}`,
  ...(params.perTargetProfiles === true
    ? []
    : ["PROVISIONING_PROFILE_SPECIFIER=", "PROVISIONING_PROFILE="]),
  "ENABLE_HARDENED_RUNTIME=YES",
  `OTHER_CODE_SIGN_FLAGS=$(inherited) --keychain ${params.identity.keychainPath}`,
  // Xcode 27 drops x86_64 from ARCHS_STANDARD once the deployment target is
  // 27+, so a universal build names both slices explicitly.
  ...(params.universal ? ["ARCHS=arm64 x86_64", "ONLY_ACTIVE_ARCH=NO"] : []),
];

/**
 * `ApplicationProperties.ApplicationPath` of an `.xcarchive`, or undefined for
 * a "Generic Xcode Archive" — the kind `-exportArchive` rejects with the
 * opaque `expected one {} but found developer-id`.
 */
const readArchiveApplicationPath = (archivePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs
      .readFile(path.join(archivePath, "Info.plist"))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (bytes === undefined) {
      return undefined;
    }
    const applicationPath = asRecord(parsePlist(Buffer.from(bytes))["ApplicationProperties"])?.[
      "ApplicationPath"
    ];
    return typeof applicationPath === "string" ? applicationPath : undefined;
  });

const exportDeveloperId = (params: {
  readonly archivePath: string;
  readonly tempDir: string;
  readonly identity: DeveloperIdIdentity;
  readonly profiles: ReadonlyMap<string, ResolvedProfile>;
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly formatter: ReturnType<typeof createXcodebuildFormatter> | undefined;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exportOptionsPath = path.join(params.tempDir, "ExportOptions.plist");
    yield* fs.writeFileString(
      exportOptionsPath,
      renderExportOptionsPlist({
        method: "developer-id",
        teamId: params.identity.teamId,
        provisioningProfiles: [...params.profiles].map(([bundleId, profile]) => ({
          bundleId,
          profileName: profile.name,
        })),
        // A SHA-1 is never ambiguous, even with the same certificate in the
        // login keychain.
        signingCertificate: params.identity.hash,
      }),
    );
    const exportPath = path.join(params.tempDir, "export");
    const exportCmd: RunStepCommand = {
      command: "xcodebuild",
      args: [
        "-exportArchive",
        "-archivePath",
        params.archivePath,
        "-exportPath",
        exportPath,
        "-exportOptionsPlist",
        exportOptionsPath,
      ],
      cwd: params.cwd,
      env: params.env,
    };
    yield* params.formatter
      ? runStepFormatted(exportCmd, "xcodebuild exportArchive", params.formatter)
      : runStep(exportCmd, "xcodebuild exportArchive");
    return yield* findAppDirectory(exportPath);
  });

/**
 * A generic archive still holds the app under `Products/Applications`, signed
 * by the archive step. Copy it out and let the CLI signer finish what
 * `-exportArchive` would have: inside-out re-sign with timestamps, preserved
 * entitlements, `get-task-allow` dropped.
 */
const signGenericArchiveApp = (params: {
  readonly archivePath: string;
  readonly tempDir: string;
  readonly identity: DeveloperIdIdentity;
  readonly entitlementsPath: string | undefined;
  readonly profiles: ReadonlyMap<string, ResolvedProfile>;
  readonly env: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const applications = path.join(params.archivePath, "Products", "Applications");
    if (!(yield* exists(applications))) {
      return yield* new BuildFailedError({
        step: "xcodebuild exportArchive",
        exitCode: 1,
        message:
          "The archive holds no application. Set SKIP_INSTALL=YES on every target except the app (frameworks, command-line tools) and archive the app's scheme.",
      });
    }
    yield* printWarn(
      'The archive is a "Generic Xcode Archive" (a target other than the app has SKIP_INSTALL=NO), which Xcode cannot export for Developer ID. Signing the app with the CLI signer instead — set SKIP_INSTALL=YES on those targets to let Xcode export it.',
    );
    const archivedApp = yield* findAppDirectory(applications);
    const appPath = path.join(params.tempDir, "export", path.basename(archivedApp));
    yield* runStep(
      { command: "ditto", args: [archivedApp, appPath], cwd: params.tempDir, env: params.env },
      "copy archived app",
    );
    yield* signMacosApp({
      appPath,
      identity: params.identity.hash,
      keychainPath: params.identity.keychainPath,
      workDir: params.tempDir,
      provisioningProfiles: params.profiles,
      ...compact({ entitlementsPath: params.entitlementsPath }),
    });
    return appPath;
  });

const runMacosXcodeBuild = <ProfileError, ProfileServices>(
  input: RunMacosBuildInput<ProfileError, ProfileServices>,
) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const { macosProfile: profile, projectRoot, tempDir } = input;
    const commandEnv = yield* runtime.commandEnvironment(input.envVars);
    const macosDir = yield* resolveMacosDir(projectRoot, profile);

    yield* installPods({ projectRoot, macosDir, profile, env: commandEnv });
    yield* runBuildHook({
      name: "eas-build-post-install",
      projectRoot,
      packageManager: input.packageManager,
      env: commandEnv,
    });

    const container = yield* resolveXcodeContainer(projectRoot, macosDir, profile, "macos");
    const scheme = profile.scheme ?? container.schemeBase;
    const configuration = profile.buildConfiguration ?? "Release";
    const profiles = yield* prepareXcodeProfiles({
      resolveProfiles: input.resolveProfiles,
      identity: input.identity,
      macosDir,
      container,
      scheme,
      configuration,
      env: commandEnv,
    });
    const archivePath = path.join(tempDir, "build.xcarchive");
    // react-native-macos bundles JS in a build phase that honours
    // SOURCEMAP_FILE, exactly like iOS; a user-set path wins.
    const embeddedSourcemapPath =
      commandEnv["SOURCEMAP_FILE"] ?? path.join(tempDir, "main.jsbundle.map");
    const archiveCmd: RunStepCommand = {
      command: "xcodebuild",
      args: [
        container.flag,
        container.containerPath,
        "-scheme",
        scheme,
        "-configuration",
        configuration,
        "-destination",
        "generic/platform=macOS",
        "-archivePath",
        archivePath,
        "archive",
        ...macosArchiveSettings({
          identity: input.identity,
          universal: profile.universal,
          perTargetProfiles: profiles.size > 0,
        }),
      ],
      cwd: macosDir,
      env: { ...commandEnv, SOURCEMAP_FILE: embeddedSourcemapPath },
    };
    const formatter = input.rawOutput ? undefined : createXcodebuildFormatter(projectRoot);
    yield* formatter
      ? runStepFormatted(archiveCmd, "xcodebuild archive", formatter)
      : runStep(archiveCmd, "xcodebuild archive");

    const applicationPath = yield* readArchiveApplicationPath(archivePath);
    const appPath =
      applicationPath === undefined
        ? yield* signGenericArchiveApp({
            archivePath,
            tempDir,
            identity: input.identity,
            entitlementsPath:
              profile.entitlements === undefined
                ? undefined
                : path.resolve(projectRoot, profile.entitlements),
            profiles,
            env: commandEnv,
          })
        : yield* exportDeveloperId({
            archivePath,
            tempDir,
            identity: input.identity,
            profiles,
            env: commandEnv,
            cwd: macosDir,
            formatter,
          });
    const debugArtifacts = yield* collectIosDebugArtifacts({
      archivePath,
      tempDir,
      embeddedSourcemapPath,
      commandEnv,
    });
    return { kind: "app", path: appPath, debugArtifacts } satisfies MacosBuildProduct;
  });

const DEVELOPER_ID_PREFIX = "Developer ID Application: ";

/**
 * The identity in the variables each desktop toolchain reads, so a custom
 * command signs with the vault certificate and no mapping of its own:
 * neutral `BETTER_UPDATE_MACOS_*`, Tauri, electron-builder, Flutter (its
 * `FLUTTER_XCODE_*` become xcodebuild settings) and Compose Multiplatform
 * (Gradle project properties via `ORG_GRADLE_PROJECT_*`). No notary
 * credentials: the CLI notarizes the final container itself, once.
 */
export const macosCustomSigningEnv = (
  identity: DeveloperIdIdentity,
): Readonly<Record<string, string>> => ({
  BETTER_UPDATE_MACOS_SIGNING_IDENTITY: identity.hash,
  BETTER_UPDATE_MACOS_SIGNING_IDENTITY_NAME: identity.name,
  BETTER_UPDATE_MACOS_KEYCHAIN: identity.keychainPath,
  BETTER_UPDATE_MACOS_P12_PATH: identity.p12Path,
  BETTER_UPDATE_MACOS_P12_PASSWORD: identity.p12Password,
  BETTER_UPDATE_MACOS_TEAM_ID: identity.teamId,
  APPLE_SIGNING_IDENTITY: identity.hash,
  APPLE_TEAM_ID: identity.teamId,
  CSC_LINK: identity.p12Path,
  CSC_KEY_PASSWORD: identity.p12Password,
  FLUTTER_XCODE_CODE_SIGN_STYLE: "Manual",
  FLUTTER_XCODE_CODE_SIGN_IDENTITY: identity.name,
  FLUTTER_XCODE_DEVELOPMENT_TEAM: identity.teamId,
  FLUTTER_XCODE_ENABLE_HARDENED_RUNTIME: "YES",
  FLUTTER_XCODE_OTHER_CODE_SIGN_FLAGS: `--keychain ${identity.keychainPath}`,
  "ORG_GRADLE_PROJECT_compose.desktop.mac.sign": "true",
  "ORG_GRADLE_PROJECT_compose.desktop.mac.signing.identity": identity.name.startsWith(
    DEVELOPER_ID_PREFIX,
  )
    ? identity.name.slice(DEVELOPER_ID_PREFIX.length)
    : identity.name,
  "ORG_GRADLE_PROJECT_compose.desktop.mac.signing.keychain": identity.keychainPath,
});

const CONTAINER_EXTENSIONS: Readonly<Record<string, MacosPackageFormat>> = {
  ".dmg": "dmg",
  ".zip": "zip",
  ".pkg": "pkg",
  ".tar.gz": "tar.gz",
};

/** `.app.tar.gz` ends in `.gz` to `path.extname`; containers are matched on the full suffix. */
const containerFormatOf = (artifactPath: string): MacosPackageFormat | undefined => {
  const lower = artifactPath.toLowerCase();
  const suffix = Object.keys(CONTAINER_EXTENSIONS).find((extension) => lower.endsWith(extension));
  return suffix === undefined ? undefined : CONTAINER_EXTENSIONS[suffix];
};

const runMacosCustomBuild = <ProfileError, ProfileServices>(
  input: RunMacosBuildInput<ProfileError, ProfileServices>,
) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const custom = input.customCommand;
    if (custom?.artifactPath === undefined) {
      return yield* new BuildFailedError({
        step: "custom macos build",
        exitCode: 1,
        message:
          'A custom macOS build needs "artifactPath": the .app it builds (e.g. "src-tauri/target/release/bundle/macos/*.app"), or a .dmg/.zip/.pkg it packages.',
      });
    }
    const extension = path.extname(custom.artifactPath).toLowerCase();
    const containerFormat = containerFormatOf(custom.artifactPath);
    if (extension !== ".app" && containerFormat === undefined) {
      return yield* new BuildFailedError({
        step: "custom macos build",
        exitCode: 1,
        message: `artifactPath "${custom.artifactPath}" must name a .app, .dmg, .zip, .pkg or .app.tar.gz.`,
      });
    }
    const commandEnv = yield* runtime.commandEnvironment(input.envVars);
    const cwd =
      custom.cwd === undefined ? input.projectRoot : path.join(input.projectRoot, custom.cwd);
    const buildStartMs = Date.now();
    yield* runStep(
      {
        command: "sh",
        args: ["-c", custom.command],
        cwd,
        env: { ...commandEnv, ...macosCustomSigningEnv(input.identity), ...custom.env },
      },
      "custom macos build",
    );
    const located = { baseDir: cwd, pattern: custom.artifactPath, minMtimeMs: buildStartMs };
    if (containerFormat === undefined) {
      const appPath = yield* findBundleByGlob(located);
      yield* printHuman(`Custom build produced ${path.basename(appPath)}`);
      return { kind: "app", path: appPath, debugArtifacts: [] } satisfies MacosBuildProduct;
    }
    const containerPath = yield* findArtifactByGlob(located);
    yield* printHuman(`Custom build produced ${path.basename(containerPath)}`);
    return {
      kind: "container",
      path: containerPath,
      format: containerFormat,
      debugArtifacts: [],
    } satisfies MacosBuildProduct;
  });

// One gen so both strategies unify into a single Effect type.
export const runMacosBuild = <ProfileError, ProfileServices>(
  input: RunMacosBuildInput<ProfileError, ProfileServices>,
) =>
  Effect.gen(function* () {
    return input.strategy === "custom"
      ? yield* runMacosCustomBuild(input)
      : yield* Effect.scoped(runMacosXcodeBuild(input));
  });
