import path from "node:path";

import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { AndroidConfig } from "@expo/config-plugins";
import { Effect } from "effect";

import { BuildFailedError } from "./exit-codes";
import { formatCause } from "./format-error";
import { buildPlistXml, parsePlistXml } from "./plist";

/**
 * EAS parity: after `expo prebuild`, bake the build profile's `channel` into
 * the generated native projects as the `expo-channel-name` request header —
 * exactly what EAS Build does (`androidSetChannelNativelyAsync` /
 * `iosSetChannelNativelyAsync` in eas-build). Writing the native files instead
 * of app.json works for dynamic configs (`app.config.ts`) too, which
 * `modifyConfigAsync` cannot patch.
 */

/** AndroidManifest meta-data key expo-updates reads extra request headers from. */
export const ANDROID_REQUEST_HEADERS_META_KEY =
  "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY";

/** Expo.plist key holding the same request-header map on iOS. */
export const IOS_REQUEST_HEADERS_PLIST_KEY = "EXUpdatesRequestHeaders";

/** Request header expo-updates sends to select the OTA channel. */
const EXPO_CHANNEL_HEADER = "expo-channel-name";

const asStringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      out[key] = raw;
    }
  }
  return out;
};

/** Merge the channel header into an existing request-header map (channel wins). */
export const withChannelHeader = (existing: unknown, channel: string): Record<string, string> => ({
  ...asStringRecord(existing),
  [EXPO_CHANNEL_HEADER]: channel,
});

/**
 * Whether the app declares `expo-updates` as a (dev)dependency. Channel
 * injection only makes sense when the updates module ships in the binary —
 * mirrors eas-build's `isExpoUpdatesInstalledAsync` gate.
 */
export const isExpoUpdatesInstalled = (
  projectRoot: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs
      .readFileString(path.join(projectRoot, "package.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    const parsed = safeJsonParse(content);
    if (!isRecord(parsed)) {
      return false;
    }
    const dependencies = isRecord(parsed["dependencies"]) ? parsed["dependencies"] : {};
    const devDependencies = isRecord(parsed["devDependencies"]) ? parsed["devDependencies"] : {};
    return "expo-updates" in dependencies || "expo-updates" in devDependencies;
  });

/**
 * Write the channel into the prebuilt `android/` project: merge it into the
 * request-headers JSON carried by the manifest meta-data entry (creating the
 * entry when prebuild emitted none).
 */
export const setAndroidUpdateChannel = (params: {
  readonly projectRoot: string;
  readonly channel: string;
}): Effect.Effect<void, BuildFailedError> =>
  Effect.tryPromise({
    try: async () => {
      const manifestPath = await AndroidConfig.Paths.getAndroidManifestAsync(params.projectRoot);
      const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(manifestPath);
      const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
      const existing = AndroidConfig.Manifest.getMainApplicationMetaDataValue(
        manifest,
        ANDROID_REQUEST_HEADERS_META_KEY,
      );
      const headers = withChannelHeader(
        existing === null ? undefined : safeJsonParse(existing),
        params.channel,
      );
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        mainApplication,
        ANDROID_REQUEST_HEADERS_META_KEY,
        JSON.stringify(headers),
      );
      await AndroidConfig.Manifest.writeAndroidManifestAsync(manifestPath, manifest);
    },
    catch: (cause) =>
      new BuildFailedError({
        step: "set android update channel",
        exitCode: 1,
        message: `Failed to write the update channel into AndroidManifest.xml: ${formatCause(cause)}`,
      }),
  });

/** Locate `ios/<target>/Supporting/Expo.plist` in a prebuilt iOS project. */
const findExpoPlist = (
  iosDir: string,
): Effect.Effect<string, BuildFailedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(iosDir).pipe(Effect.orElseSucceed(() => []));
    for (const entry of entries) {
      const candidate = path.join(iosDir, entry, "Supporting", "Expo.plist");
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return candidate;
      }
    }
    return yield* new BuildFailedError({
      step: "set ios update channel",
      exitCode: 1,
      message: `No Supporting/Expo.plist found under ${iosDir} after prebuild — is "expo-updates" installed?`,
    });
  });

/**
 * Write the channel into the prebuilt `ios/` project: merge it into the
 * `EXUpdatesRequestHeaders` dict of the generated Expo.plist.
 */
export const setIosUpdateChannel = (params: {
  readonly iosDir: string;
  readonly channel: string;
}): Effect.Effect<void, BuildFailedError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plistPath = yield* findExpoPlist(params.iosDir);
    const failure = (cause: unknown) =>
      new BuildFailedError({
        step: "set ios update channel",
        exitCode: 1,
        message: `Failed to write the update channel into ${plistPath}: ${formatCause(cause)}`,
      });
    const content = yield* fs.readFileString(plistPath).pipe(Effect.mapError(failure));
    const parsed = yield* Effect.try({
      try: (): unknown => parsePlistXml(content),
      catch: failure,
    });
    if (!isRecord(parsed)) {
      return yield* failure("Expo.plist is not a plist dictionary.");
    }
    const next = {
      ...parsed,
      [IOS_REQUEST_HEADERS_PLIST_KEY]: withChannelHeader(
        parsed[IOS_REQUEST_HEADERS_PLIST_KEY],
        params.channel,
      ),
    };
    const rendered = buildPlistXml(next);
    yield* fs.writeFileString(plistPath, `${rendered}\n`).pipe(Effect.mapError(failure));
  });
