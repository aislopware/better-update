import path from "node:path";

import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
// `@expo/config-plugins` is a CommonJS module. A NAMED ESM import
// (`import { AndroidConfig } from …`) fails at runtime under Node's ESM loader
// with "Named export 'AndroidConfig' not found" because cjs-module-lexer cannot
// statically detect the export — which is what forced the CLI to be run under
// Bun. A default import resolves to `module.exports`, from which `AndroidConfig`
// destructures cleanly under both Node and Bun.
import configPlugins from "@expo/config-plugins";
import { FileSystem, Effect } from "effect";

import { BuildFailedError } from "./exit-codes";
import { formatCause } from "./format-error";
import { buildPlistXml, parsePlistXml } from "./plist";
import { printWarn } from "./warning-style";

import type { OutputMode } from "./output-mode";

const { AndroidConfig } = configPlugins;

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
 * Warn — loudly — that the channel could not be baked in.
 *
 * NOT an error, deliberately. Injection runs for every strategy now, including
 * committed and custom trees whose layout this code cannot know, so a
 * not-found target is "we could not reach it here", not "the project is
 * misconfigured": failing would turn builds that were green on the previous
 * release red, with nothing the user can change short of restructuring. The
 * bug being fixed was SILENCE, and a warning already ends that.
 */
const warnChannelNotInjected = (params: {
  readonly platform: "Android" | "iOS";
  readonly searched: string;
  readonly channel: string;
}) =>
  printWarn(
    `Could not bake the update channel "${params.channel}" into the ${params.platform} build: ` +
      `${params.searched}. The binary will fall back to the server's DEFAULT channel at runtime, ` +
      `so updates published to "${params.channel}" may never reach it. Point the build at the ` +
      `native project that ships, inject "expo-channel-name" yourself, or drop "channel" from the ` +
      `profile if this platform does not do OTA.`,
  );

/**
 * Manifest locations to try, most specific first. Prebuild always emits
 * `android/app/src/main/`, but injection also runs on committed trees, where a
 * Gradle module override, a Kotlin-Multiplatform layout or a root-level native
 * module puts the manifest elsewhere.
 */
const androidManifestCandidates = (module: string | undefined): readonly string[] => [
  // The Gradle module actually assembled, when the profile names one — it is
  // the module that ships, so its manifest is the only correct target.
  ...(module === undefined ? [] : [`android/${module}/src/main/AndroidManifest.xml`]),
  // What prebuild emits, and what `@expo/config-plugins` assumes.
  "android/app/src/main/AndroidManifest.xml",
  "composeApp/src/androidMain/AndroidManifest.xml",
  "androidApp/src/main/AndroidManifest.xml",
  "app/src/main/AndroidManifest.xml",
];

/**
 * Resolve the manifest to inject into, or `undefined` when none is reachable.
 *
 * Note this does NOT use `AndroidConfig.Paths.getAndroidManifestAsync`: that
 * helper only asserts the `android/` DIRECTORY exists and then returns
 * `android/app/src/main/AndroidManifest.xml` unconditionally, existent or not.
 * Injection now runs on committed trees too, so the path has to be verified —
 * otherwise a KMP layout gets a confusing read error from a path it never used.
 */
const findAndroidManifest = (
  projectRoot: string,
  candidates: readonly string[],
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const relative of candidates) {
      const candidate = path.join(projectRoot, relative);
      const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return candidate;
      }
    }
    return undefined;
  });

/**
 * Write the channel into the `android/` project: merge it into the
 * request-headers JSON carried by the manifest meta-data entry (creating the
 * entry when none is present).
 *
 * Runs for every build strategy, not just prebuild, so the manifest may be a
 * committed file rather than a generated one — same injection either way. A
 * write that FAILS is still fatal; only a target that cannot be found warns.
 */
export const setAndroidUpdateChannel = (params: {
  readonly projectRoot: string;
  readonly channel: string;
  /** Gradle module being assembled (profile `android.module`), if overridden. */
  readonly module?: string | undefined;
}): Effect.Effect<void, BuildFailedError, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    const candidates = androidManifestCandidates(params.module);
    const manifestPath = yield* findAndroidManifest(params.projectRoot, candidates);
    if (manifestPath === undefined) {
      return yield* warnChannelNotInjected({
        platform: "Android",
        channel: params.channel,
        searched: `no AndroidManifest.xml under ${params.projectRoot} (looked in ${candidates.join(", ")})`,
      });
    }
    return yield* Effect.tryPromise({
      try: async () => {
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
          message: `Failed to write the update channel into ${manifestPath}: ${formatCause(cause)}`,
        }),
    });
  });

/**
 * Locate the main target's `Expo.plist`, or `undefined` when there is none.
 *
 * Prebuild always emits `ios/<target>/Supporting/Expo.plist`, but this also
 * runs on committed trees, where the file is often kept directly under the
 * target group. The two layouts are searched in SEPARATE passes, not
 * interleaved per directory: in a multi-target project an extension or app
 * clip may carry its own plist, and directory order is alphabetical, so a
 * per-entry search could return `ios/AppClip/Expo.plist` ahead of the app's
 * `ios/MyApp/Supporting/Expo.plist` and bake the channel into the wrong
 * binary. Preferring the prebuild layout across all targets keeps the main app
 * winning wherever it uses the generated shape.
 */
const findExpoPlist = (
  iosDir: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(iosDir).pipe(Effect.orElseSucceed(() => []));
    for (const segments of [["Supporting", "Expo.plist"], ["Expo.plist"]]) {
      for (const entry of entries) {
        const candidate = path.join(iosDir, entry, ...segments);
        const exists = yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));
        if (exists) {
          return candidate;
        }
      }
    }
    return undefined;
  });

/**
 * Write the channel into the `ios/` project: merge it into the
 * `EXUpdatesRequestHeaders` dict of the target's Expo.plist.
 *
 * Runs for every build strategy, so the plist may be committed rather than
 * generated. A write that FAILS is still fatal; only a target that cannot be
 * found warns — see `warnChannelNotInjected`.
 */
export const setIosUpdateChannel = (params: {
  readonly iosDir: string;
  readonly channel: string;
}): Effect.Effect<void, BuildFailedError, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const plistPath = yield* findExpoPlist(params.iosDir);
    if (plistPath === undefined) {
      return yield* warnChannelNotInjected({
        platform: "iOS",
        channel: params.channel,
        searched: `no Expo.plist under ${params.iosDir} (looked for <target>/Supporting/Expo.plist and <target>/Expo.plist)`,
      });
    }
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
