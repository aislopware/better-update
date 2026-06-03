import { Buffer } from "node:buffer";
import path from "node:path";

import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError, UploadFailedError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
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
import { readProjectId } from "../../lib/project-link";
import { acquireBuildTempDir } from "../../lib/temp-dir";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

type ArtifactFormat = "ipa" | "apk" | "aab" | "tar.gz";

const RUN_EXIT_EXTRAS = {
  UploadFailedError: 7,
  NativeRunError: 6,
  InvalidArgumentError: 2,
} as const;

const fetchArtifact = (url: string): Effect.Effect<Buffer, UploadFailedError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () => fetch(url),
      catch: (cause) =>
        new UploadFailedError({ message: `Failed to request artifact: ${formatCause(cause)}` }),
    });
    if (!response.ok) {
      return yield* new UploadFailedError({
        message: `HTTP ${String(response.status)} ${response.statusText}`,
      });
    }
    const buffer = yield* Effect.tryPromise({
      try: async () => response.arrayBuffer(),
      catch: (cause) =>
        new UploadFailedError({ message: `Failed to read artifact body: ${formatCause(cause)}` }),
    });
    return Buffer.from(buffer);
  });

const resolveBuild = (params: {
  readonly api: ApiClient;
  readonly id: string | undefined;
  readonly latest: boolean;
  readonly platform: "ios" | "android" | undefined;
  readonly projectId: string;
}) =>
  Effect.gen(function* () {
    if (params.id !== undefined) {
      return yield* params.api.builds.get({ path: { id: params.id } });
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
      urlParams: { projectId: params.projectId, platform: params.platform, limit: 1 },
    });
    const [first] = list.items;
    if (!first) {
      return yield* new InvalidArgumentError({
        message: `No builds found for platform ${params.platform}.`,
      });
    }
    return yield* params.api.builds.get({ path: { id: first.id } });
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
          ".aab artifacts cannot be installed directly. Use bundletool to convert to apks, or download the play-store APK.",
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

export const runCommand = defineCommand({
  meta: {
    name: "run",
    description: "Install and launch a build on a simulator/emulator or device",
  },
  args: {
    id: { type: "positional", required: false, description: "Build ID (or use --latest)" },
    latest: { type: "boolean", description: "Pick the most recent build for --platform" },
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Platform filter (required with --latest)",
    },
    simulator: {
      type: "string",
      description: "iOS simulator name or UDID (iOS simulator/tar.gz builds)",
    },
    "device-id": {
      type: "string",
      description: "Real-device UDID (iOS .ipa via xcrun devicectl)",
    },
    device: {
      type: "boolean",
      description: "Force real-device install for iOS .ipa (default: simulator if possible)",
    },
    emulator: {
      type: "string",
      description: "Android adb serial (emulator or device)",
    },
    package: {
      type: "string",
      description: "Android package name override (used when aapt/aapt2 is unavailable)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const api = yield* apiClient;
          const projectId = yield* readProjectId;
          const build = yield* resolveBuild({
            api,
            id: args.id,
            latest: args.latest ?? false,
            platform: args.platform,
            projectId,
          });
          const { artifact } = build;
          if (!artifact) {
            return yield* new UploadFailedError({
              message: `Build ${build.id} has no artifact yet.`,
            });
          }
          const link = yield* api.builds.getInstallLink({ path: { id: build.id } });
          const tempDir = yield* acquireBuildTempDir;
          const artifactPath = path.join(tempDir, `artifact.${artifact.format}`);
          yield* printHuman(
            `Downloading ${artifact.format} artifact (${String(artifact.byteSize)} bytes)...`,
          );
          const bytes = yield* fetchArtifact(link.artifactUrl);
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFile(artifactPath, bytes);

          yield* build.platform === "ios"
            ? runIos({
                tempDir,
                artifactPath,
                format: artifact.format,
                simulatorSelector: args.simulator,
                deviceSelector: args["device-id"],
                useDevice: args.device ?? false,
              })
            : runAndroid({
                artifactPath,
                format: artifact.format,
                emulatorSelector: args.emulator,
                packageOverride: args.package,
              });
          return {
            buildId: build.id,
            platform: build.platform,
            format: artifact.format,
            installed: true,
          };
        }),
      ),
      { exits: RUN_EXIT_EXTRAS, json: "value" },
    ),
});
