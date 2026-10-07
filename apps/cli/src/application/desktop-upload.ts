/**
 * Uploading Windows and Linux artifacts — installers and packages built by a
 * `custom.<platform>` command or elsewhere (a Windows CI runner) — as builds.
 * Each file is its own build: an electron-builder run that makes an NSIS
 * installer and an MSI, or a Tauri one that makes an AppImage, a deb and an
 * rpm, uploads every one, and the feeds pick per updater.
 *
 * What a build records comes from, in order: the profile's `<platform>`
 * section (an explicit override), the app's own config (tauri.conf.json,
 * package.json), and the artifact itself (deb control, rpm header, AppImage
 * ELF header and embedded blockmap, the file name's arch token).
 */
import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import type { DesktopBuildMetadata } from "@better-update/api";

import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBuildProfile } from "../lib/build-profile";
import { readDesktopAppConfig } from "../lib/desktop-app-config";
import { desktopFileTarget, inspectDesktopArtifact } from "../lib/desktop-artifact-inspect";
import { easJsonPath } from "../lib/eas-config";
import { BuildProfileError, InvalidArgumentError } from "../lib/exit-codes";
import { readGitContext } from "../lib/git-context";
import { printHuman, printTable } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { sha256File } from "../lib/sha256";
import { printWarn } from "../lib/warning-style";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { DesktopProfile } from "../lib/build-profile";
import type { DesktopAppConfig } from "../lib/desktop-app-config";
import type { InspectedDesktopArtifact } from "../lib/desktop-artifact-inspect";
import type { ApiClient } from "../services/api-client";

export type DesktopUploadPlatform = "windows" | "linux";

export interface DescribedDesktopArtifact {
  readonly artifactPath: string;
  readonly target: Extract<BuildTarget, { readonly platform: DesktopUploadPlatform }>;
  readonly bundleId: string;
  readonly appVersion: string;
  readonly buildNumber: string | undefined;
  readonly metadata: DesktopBuildMetadata;
}

const PROFILE_HINT: Record<DesktopUploadPlatform, string> = {
  windows: 'the profile\'s "windows" section in eas.json',
  linux: 'the profile\'s "linux" section in eas.json',
};

const readArtifact = (platform: DesktopUploadPlatform, artifactPath: string) =>
  Effect.gen(function* () {
    const fileName = path.basename(artifactPath);
    const target = desktopFileTarget(fileName);
    if (target?.platform !== platform) {
      return yield* new InvalidArgumentError({
        message:
          platform === "windows"
            ? `${fileName} is not a Windows installer (.exe or .msi).`
            : `${fileName} is not a Linux package (.AppImage, .deb or .rpm).`,
      });
    }
    const bytes = yield* (yield* FileSystem.FileSystem).readFile(artifactPath).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidArgumentError({
            message: `Could not read ${artifactPath}: ${String(cause)}`,
          }),
      ),
    );
    return yield* Effect.promise(async () => inspectDesktopArtifact(target, fileName, bytes));
  });

/** The version and identifier a build needs, the profile's first, then the app's, then the file's. */
const resolveIdentity = (params: {
  readonly fileName: string;
  readonly platform: DesktopUploadPlatform;
  readonly profile: DesktopProfile | undefined;
  readonly config: DesktopAppConfig;
  readonly inspected: InspectedDesktopArtifact;
}) =>
  Effect.gen(function* () {
    const { fileName, profile, config, inspected } = params;
    const hint = PROFILE_HINT[params.platform];
    const appVersion = profile?.version ?? config.version ?? inspected.packageVersion;
    if (appVersion === undefined) {
      return yield* new BuildProfileError({
        message: `Could not tell ${fileName}'s version: no tauri.conf.json or package.json version, and the file records none. Set "version" in ${hint}.`,
      });
    }
    const bundleId = profile?.bundleIdentifier ?? config.bundleId ?? inspected.packageName;
    if (bundleId === undefined) {
      return yield* new BuildProfileError({
        message: `Could not tell ${fileName}'s app identifier: no Tauri "identifier" or electron-builder "appId". Set "bundleIdentifier" in ${hint}.`,
      });
    }
    return { appVersion, bundleId };
  });

/** What the upload will get wrong or do without, said before it happens. */
const reportGaps = (params: {
  readonly fileName: string;
  readonly platform: DesktopUploadPlatform;
  readonly appVersion: string;
  readonly architectures: readonly string[] | undefined;
  readonly inspected: InspectedDesktopArtifact;
}) =>
  Effect.gen(function* () {
    const { fileName, appVersion, inspected } = params;
    const recorded = inspected.packageVersion;
    if (
      recorded !== undefined &&
      recorded !== appVersion &&
      !recorded.startsWith(`${appVersion}-`)
    ) {
      yield* printWarn(
        `${fileName} records version ${recorded}, but the build is uploaded as ${appVersion}. Update feeds compare ${appVersion}.`,
      );
    }
    if (params.architectures === undefined) {
      yield* printWarn(
        `${fileName} names no architecture; feeds treat it as x64. Set "arch" in ${PROFILE_HINT[params.platform]} if it is not.`,
      );
    }
    if (inspected.target.format === "appimage" && inspected.blockMapSize === undefined) {
      yield* printHuman(
        `${fileName} carries no embedded blockmap: electron-updater downloads its updates in full.`,
      );
    }
  });

/** Everything one Windows / Linux artifact's build records, or why it cannot be uploaded. */
export const describeDesktopArtifact = (params: {
  readonly platform: DesktopUploadPlatform;
  readonly artifactPath: string;
  readonly profile: DesktopProfile | undefined;
  /** Where the app's own config may live: the project root, a custom command's cwd. */
  readonly configDirs: readonly string[];
}) =>
  Effect.gen(function* () {
    const { platform, artifactPath, profile } = params;
    const fileName = path.basename(artifactPath);
    const inspected = yield* readArtifact(platform, artifactPath);
    const config = yield* readDesktopAppConfig(params.configDirs, platform);
    const { appVersion, bundleId } = yield* resolveIdentity({
      fileName,
      platform,
      profile,
      config,
      inspected,
    });
    const architectures = inspected.architectures ?? profile?.arch;
    yield* reportGaps({ fileName, platform, appVersion, architectures, inspected });
    const { target } = inspected;
    const windows = platform === "windows" ? profile : undefined;
    const described: DescribedDesktopArtifact = {
      artifactPath,
      target:
        target.platform === "windows"
          ? { platform: "windows", distribution: "direct", artifactFormat: target.format }
          : { platform: "linux", distribution: "direct", artifactFormat: target.format },
      bundleId,
      appVersion,
      buildNumber: profile?.buildNumber,
      metadata: compact({
        appName: profile?.appName ?? config.appName ?? inspected.packageName,
        architectures,
        minimumSystemVersion: windows?.minimumSystemVersion,
        tauriPublicKey: config.tauriPublicKey,
        winSparklePublicKey: windows?.winSparklePublicKey,
        blockMapSize: inspected.blockMapSize,
        packageName: inspected.packageName,
        debControl: inspected.debControl,
      }),
    };
    return described;
  });

export interface UploadedDesktopBuild {
  readonly id: string;
  readonly artifactPath: string;
  readonly format: string;
  readonly architectures: readonly string[];
  readonly appVersion: string;
}

/** Describe every file first — one bad file uploads none — then upload each as its own build. */
export const uploadDesktopArtifacts = (
  api: ApiClient,
  params: {
    readonly platform: DesktopUploadPlatform;
    readonly artifactPaths: readonly string[];
    readonly profile: DesktopProfile | undefined;
    readonly profileName: string;
    readonly configDirs: readonly string[];
    readonly projectId: string;
    readonly gitContext: {
      readonly ref?: string;
      readonly commit?: string;
      readonly dirty: boolean;
    };
    readonly message: string | undefined;
  },
) =>
  Effect.gen(function* () {
    const described = yield* Effect.all(
      params.artifactPaths.map((artifactPath) =>
        describeDesktopArtifact({
          platform: params.platform,
          artifactPath,
          profile: params.profile,
          configDirs: params.configDirs,
        }),
      ),
    );
    const uploaded = yield* Effect.all(
      described.map((artifact) =>
        Effect.gen(function* () {
          yield* printHuman(`Uploading ${path.basename(artifact.artifactPath)}...`);
          const { sha256, byteSize } = yield* sha256File(artifact.artifactPath);
          const result = yield* reserveAndUpload(api, {
            target: artifact.target,
            projectId: params.projectId,
            profileName: params.profileName,
            bundleId: artifact.bundleId,
            appVersion: artifact.appVersion,
            gitContext: params.gitContext,
            artifactPath: artifact.artifactPath,
            sha256,
            byteSize,
            metadata: { [params.platform]: artifact.metadata },
            ...compact({ buildNumber: artifact.buildNumber, message: params.message }),
          });
          const build: UploadedDesktopBuild = {
            id: result.id,
            artifactPath: artifact.artifactPath,
            format: artifact.target.artifactFormat,
            architectures: artifact.metadata.architectures ?? [],
            appVersion: artifact.appVersion,
          };
          return build;
        }),
      ),
    );
    yield* printHuman("");
    yield* printTable(
      ["Build ID", "Format", "Arch", "Version", "Artifact"],
      uploaded.map((build) => [
        build.id,
        build.format,
        build.architectures.join(",") || "x64",
        build.appVersion,
        path.basename(build.artifactPath),
      ]),
    );
    yield* printHuman(
      `\nPublish to the update feeds with: better-update ${params.platform} release create`,
    );
    return uploaded;
  });

/**
 * The profile's `<platform>` section when the project has an eas.json — an
 * artifact built elsewhere needs none, so a missing file is no error, but a
 * broken one or an unknown profile is.
 */
const readOptionalDesktopProfile = (
  projectRoot: string,
  profileName: string,
  platform: DesktopUploadPlatform,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const hasEasJson = yield* fs
      .exists(easJsonPath(projectRoot))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasEasJson) {
      return { profile: undefined, customCwd: undefined };
    }
    const profile = yield* readBuildProfile(projectRoot, profileName);
    return { profile: profile[platform], customCwd: profile.customCommand?.[platform]?.cwd };
  });

/** `builds upload --platform windows|linux <file…>`. */
export const runDesktopUploadWorkflow = (options: {
  readonly platform: DesktopUploadPlatform;
  readonly profileName: string;
  readonly artifactPaths: readonly string[];
  readonly message: string | undefined;
}) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const projectRoot = yield* (yield* CliRuntime).cwd;
    const projectId = yield* readProjectId;
    const { profile, customCwd } = yield* readOptionalDesktopProfile(
      projectRoot,
      options.profileName,
      options.platform,
    );
    const git = yield* readGitContext(projectRoot);
    return yield* uploadDesktopArtifacts(api, {
      platform: options.platform,
      artifactPaths: options.artifactPaths.map((file) => path.resolve(projectRoot, file)),
      profile,
      profileName: options.profileName,
      configDirs:
        customCwd === undefined ? [projectRoot] : [path.join(projectRoot, customCwd), projectRoot],
      projectId,
      gitContext: compact({ ref: git.ref, commit: git.commit, dirty: git.dirty }),
      message: options.message,
    });
  });
