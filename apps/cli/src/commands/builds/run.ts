import path from "node:path";

import { FileSystem, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { InvalidArgumentError, UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import {
  extractTarGz,
  extractZip,
  findAppBundle,
  installAndLaunchAndroid,
  installAndLaunchIosDevice,
  installAndLaunchIosSimulator,
  NativeRunError,
  pickAndroidDevice,
  pickSimulator,
  readApkPackageName,
  readBundleIdFromApp,
} from "../../lib/native-runner";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { optionalArgument, optionalFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { acquireBuildTempDir } from "../../lib/temp-dir";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

type ArtifactFormat = "ipa" | "apk" | "aab" | "tar.gz";

const resolveBuild = (params: {
  readonly api: ApiClient;
  readonly id: string | undefined;
  readonly latest: boolean;
  readonly platform: "ios" | "android" | undefined;
  readonly projectId: string;
}) =>
  Effect.gen(function* () {
    if (params.id !== undefined) {
      return yield* params.api.builds.get({ params: { id: params.id } });
    }
    if (!params.latest) {
      return yield* new InvalidArgumentError({
        message: "Pass a build id, or use --latest --platform <ios|android>.",
      });
    }
    if (!params.platform) {
      return yield* new InvalidArgumentError({
        message: "--latest requires --platform <ios|android>.",
      });
    }
    const list = yield* params.api.builds.list({
      query: { projectId: params.projectId, platform: params.platform, limit: 1 },
    });
    const [first] = list.items;
    if (!first) {
      return yield* new InvalidArgumentError({
        message: `No builds found for platform ${params.platform}.`,
      });
    }
    return yield* params.api.builds.get({ params: { id: first.id } });
  });

interface IosRunParams {
  readonly tempDir: string;
  readonly artifactPath: string;
  readonly format: ArtifactFormat;
  readonly simulatorSelector: string | undefined;
  readonly deviceSelector: string | undefined;
  readonly useDevice: boolean;
}

const extractIosArtifact = (params: {
  readonly tempDir: string;
  readonly artifactPath: string;
  readonly format: ArtifactFormat;
  readonly subdir: string;
}) =>
  Effect.gen(function* () {
    const extractDir = path.join(params.tempDir, params.subdir);
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(extractDir, { recursive: true });
    yield* params.format === "tar.gz"
      ? extractTarGz(params.artifactPath, extractDir)
      : extractZip(params.artifactPath, extractDir);
    return extractDir;
  });

const runIosSimulator = (params: IosRunParams) =>
  Effect.gen(function* () {
    const extractDir = yield* extractIosArtifact({
      tempDir: params.tempDir,
      artifactPath: params.artifactPath,
      format: params.format,
      subdir: "ios-simulator",
    });
    const appDir = yield* findAppBundle(extractDir);
    const bundleId = yield* readBundleIdFromApp(appDir);
    const simulator = yield* pickSimulator(params.simulatorSelector);
    yield* printHuman(`Installing on simulator "${simulator.name}" (${simulator.udid})...`);
    yield* installAndLaunchIosSimulator({ udid: simulator.udid, appDir, bundleId });
    yield* printHumanKeyValue([
      ["Simulator", simulator.name],
      ["Bundle ID", bundleId],
      ["App", appDir],
    ]);
  });

const runIosDevice = (params: IosRunParams) =>
  Effect.gen(function* () {
    const { deviceSelector } = params;
    if (deviceSelector === undefined) {
      return yield* new InvalidArgumentError({
        message:
          "Pass --device-id <udid>. Run `xcrun devicectl list devices` to list connected devices.",
      });
    }
    const extractDir = yield* extractIosArtifact({
      tempDir: params.tempDir,
      artifactPath: params.artifactPath,
      format: params.format,
      subdir: "ios-device",
    });
    const appDir = yield* findAppBundle(extractDir);
    const bundleId = yield* readBundleIdFromApp(appDir);
    yield* printHuman(`Installing IPA on device ${deviceSelector}...`);
    yield* installAndLaunchIosDevice({
      udid: deviceSelector,
      ipaPath: params.artifactPath,
      bundleId,
    });
    yield* printHumanKeyValue([
      ["Device", deviceSelector],
      ["Bundle ID", bundleId],
      ["IPA", params.artifactPath],
    ]);
  });

const runIos = (params: IosRunParams) => {
  if (params.format === "tar.gz") {
    return runIosSimulator(params);
  }
  if (params.format === "ipa") {
    return params.useDevice ? runIosDevice(params) : runIosSimulator(params);
  }
  return Effect.fail(
    new NativeRunError({
      message: `Cannot install ${params.format} on iOS; only tar.gz (simulator) or ipa are supported.`,
    }),
  );
};

interface AndroidRunParams {
  readonly artifactPath: string;
  readonly format: ArtifactFormat;
  readonly emulatorSelector: string | undefined;
  readonly packageOverride: string | undefined;
}

const runAndroid = (params: AndroidRunParams) =>
  Effect.gen(function* () {
    if (params.format === "aab") {
      return yield* new InvalidArgumentError({
        message:
          "This App Bundle build has no universal APK attached, and an .aab cannot be installed directly. Rebuild with the current CLI (the APK is attached automatically), or convert locally: bundletool build-apks --mode=universal.",
      });
    }
    if (params.format !== "apk") {
      return yield* new NativeRunError({
        message: `Cannot install ${params.format} on Android; only apk is supported.`,
      });
    }
    const device = yield* pickAndroidDevice(params.emulatorSelector);
    const detected = yield* readApkPackageName(params.artifactPath);
    const packageName = params.packageOverride ?? detected;
    if (!packageName) {
      return yield* new InvalidArgumentError({
        message:
          "Could not detect APK package name (aapt/aapt2 not on PATH). Pass --package <name> explicitly.",
      });
    }
    yield* printHuman(`Installing on Android device ${device.serial}...`);
    yield* installAndLaunchAndroid({
      serial: device.serial,
      apkPath: params.artifactPath,
      packageName,
    });
    yield* printHumanKeyValue([
      ["Device", device.serial],
      ["Package", packageName],
      ["APK", params.artifactPath],
    ]);
  });

export const runBuildCommand = Command.make(
  "run",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("Build ID (or use --latest)"),
      optionalArgument,
    ),
    latest: Flag.Boolean("latest").pipe(
      Flag.withDescription("Pick the most recent build for --platform"),
      Flag.withDefault(false),
    ),
    platform: Flag.Literals("platform", ["ios", "android"]).pipe(
      Flag.withDescription("Platform filter (required with --latest)"),
      optionalFlag,
    ),
    simulator: Flag.String("simulator").pipe(
      Flag.withDescription("iOS simulator name or UDID (iOS simulator/tar.gz builds)"),
      optionalFlag,
    ),
    "device-id": Flag.String("device-id").pipe(
      Flag.withDescription("Real-device UDID (iOS .ipa via xcrun devicectl)"),
      optionalFlag,
    ),
    device: Flag.Boolean("device").pipe(
      Flag.withDescription(
        "Force real-device install for iOS .ipa (default: simulator if possible)",
      ),
      Flag.withDefault(false),
    ),
    emulator: Flag.String("emulator").pipe(
      Flag.withDescription("Android adb serial (emulator or device)"),
      optionalFlag,
    ),
    package: Flag.String("package").pipe(
      Flag.withDescription("Android package name override (used when aapt/aapt2 is unavailable)"),
      optionalFlag,
    ),
  },
  (args) =>
    Effect.scoped(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const projectId = yield* readProjectId;
        const build = yield* resolveBuild({
          api,
          id: args.id,
          latest: args.latest,
          platform: args.platform,
          projectId,
        });
        const { artifact } = build;
        if (!artifact) {
          return yield* new UploadFailedError({
            message: `Build ${build.id} has no artifact yet.`,
          });
        }
        const link = yield* api.builds.getInstallLink({ params: { id: build.id } });
        // An `.aab` build installs through its universal APK companion when
        // one was attached; the bundle itself is Play-only.
        const installable =
          artifact.format === "aab" && build.installArtifact && link.installUrl
            ? {
                url: link.installUrl,
                format: "apk" as const,
                byteSize: build.installArtifact.byteSize,
              }
            : { url: link.artifactUrl, format: artifact.format, byteSize: artifact.byteSize };
        const tempDir = yield* acquireBuildTempDir;
        const artifactPath = path.join(tempDir, `artifact.${installable.format}`);
        yield* printHuman(
          `Downloading ${installable.format} artifact (${String(installable.byteSize)} bytes)...`,
        );
        const bytes = yield* fetchBytes(installable.url, "artifact");
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFile(artifactPath, bytes);

        yield* build.platform === "ios"
          ? runIos({
              tempDir,
              artifactPath,
              format: installable.format,
              simulatorSelector: args.simulator,
              deviceSelector: args["device-id"],
              useDevice: args.device,
            })
          : runAndroid({
              artifactPath,
              format: installable.format,
              emulatorSelector: args.emulator,
              packageOverride: args.package,
            });
        return {
          buildId: build.id,
          platform: build.platform,
          format: installable.format,
          installed: true,
        };
      }),
    ).pipe(runCommand({ json: "value" })),
).pipe(Command.withDescription("Install and launch a build on a simulator/emulator or device"));
