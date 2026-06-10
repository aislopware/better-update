import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import { runAndroidBuild } from "../commands/build/android";
import { runIosBuild } from "../commands/build/ios";
import { resolveAndroidStrategy, resolveIosStrategy } from "../lib/build-strategy";
import { BuildProfileError } from "../lib/exit-codes";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { ensureAndroidCredentials, ensureIosCredentials } from "./credentials-interactive";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { Platform, readBuildProfile } from "../lib/build-profile";
import type { ProjectType } from "../lib/detect-project-type";
import type { readAppMeta } from "../lib/expo-config";
import type { PackageManager } from "../lib/project-staging";
import type { apiClient } from "../services/api-client";

export type AppMeta = Effect.Effect.Success<ReturnType<typeof readAppMeta>>;
export type BuildProfile = Effect.Effect.Success<ReturnType<typeof readBuildProfile>>;
type ApiClient = Effect.Effect.Success<typeof apiClient>;

export interface PlatformBuildInput {
  readonly api: ApiClient;
  readonly platform: Platform;
  readonly profile: BuildProfile;
  readonly projectType: ProjectType;
  readonly appMeta: AppMeta;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly tempDir: string;
  /** Package manager of the staged workspace — used to run lifecycle hooks. */
  readonly packageManager: PackageManager;
  /** Channel baked into the native app at prebuild; undefined skips injection. */
  readonly updateChannel: string | undefined;
  readonly freezeCredentials: boolean;
  readonly rawOutput: boolean | undefined;
}

const runIosPlatformBuild = (input: PlatformBuildInput) =>
  Effect.gen(function* () {
    const { api, appMeta, envVars, profile, projectId, projectRoot, tempDir } = input;
    if (!profile.ios) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no ios section.`,
      });
    }
    const iosProfile = profile.ios;
    const iosBundleId = appMeta.bundleId;
    if (!iosBundleId) {
      return yield* new BuildProfileError({
        message: "Missing iOS bundle identifier (set ios.bundleIdentifier or your Expo config).",
      });
    }
    const strategy = resolveIosStrategy(profile, input.projectType);
    const isSimulator = iosProfile.simulator === true;
    const credentialsSource = profile.credentialsSource ?? "remote";
    // Custom builds own their own signing; only the native xcodebuild path needs
    // server-managed credentials pre-ensured here.
    if (strategy !== "custom" && !isSimulator && credentialsSource === "remote") {
      yield* ensureIosCredentials(
        api,
        {
          projectId,
          bundleIdentifier: iosBundleId,
          distribution: iosProfile.distribution,
        },
        { freezeCredentials: input.freezeCredentials },
      );
    }
    const build = yield* runIosBuild({
      api,
      tempDir,
      projectRoot,
      iosProfile,
      bundleId: iosBundleId,
      envVars,
      projectId,
      credentialsSource,
      strategy,
      packageManager: input.packageManager,
      rawOutput: input.rawOutput,
      freezeCredentials: input.freezeCredentials,
      updateChannel: input.updateChannel,
      ...compact({ customCommand: profile.customCommand?.ios }),
    });
    const target: BuildTarget = isSimulator
      ? { platform: "ios", distribution: "simulator", artifactFormat: "tar.gz" }
      : { platform: "ios", distribution: iosProfile.distribution, artifactFormat: "ipa" };
    return { build, target, bundleId: iosBundleId };
  });

const runAndroidPlatformBuild = (input: PlatformBuildInput) =>
  Effect.gen(function* () {
    const { api, appMeta, envVars, profile, projectId, projectRoot, tempDir } = input;
    if (!profile.android) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no android section.`,
      });
    }
    const androidProfile = profile.android;
    const androidBundleId = appMeta.androidPackage;
    if (!androidBundleId) {
      return yield* new BuildProfileError({
        message: "Missing Android applicationId (set android.applicationId or your Expo config).",
      });
    }
    const strategy = resolveAndroidStrategy(profile, input.projectType);
    // Cross-validate Gradle config against the resolved package (Groovy only).
    // When Gradle resolves a different applicationId, the built APK/AAB is signed
    // under that id — so the credential resolver must key off the Gradle value.
    const androidDir = `${projectRoot}/android`;
    const gradleConfig = yield* readGradleConfig(androidDir);
    yield* warnOnGradleMismatch(gradleConfig, androidBundleId);
    const applicationIdentifier = gradleConfig?.applicationId ?? androidBundleId;
    const credentialsSource = profile.credentialsSource ?? "remote";
    // EAS parity: developmentClient=true or withoutCredentials=true skips the
    // server keystore lookup so dev builds work without registering a keystore.
    const skipCredentials =
      profile.developmentClient === true || profile.withoutCredentials === true;
    if (credentialsSource === "remote" && !skipCredentials) {
      yield* ensureAndroidCredentials(
        api,
        { projectId, applicationIdentifier },
        { freezeCredentials: input.freezeCredentials },
      );
    }
    const build = yield* runAndroidBuild({
      api,
      tempDir,
      projectRoot,
      androidProfile,
      applicationIdentifier,
      envVars,
      projectId,
      credentialsSource,
      profileName: profile.name,
      skipCredentials,
      strategy,
      packageManager: input.packageManager,
      updateChannel: input.updateChannel,
      ...compact({ customCommand: profile.customCommand?.android }),
    });
    const target: BuildTarget =
      androidProfile.format === "aab"
        ? { platform: "android", distribution: "play-store", artifactFormat: "aab" }
        : { platform: "android", distribution: "direct", artifactFormat: "apk" };
    return { build, target, bundleId: applicationIdentifier };
  });

// Wrapped in gen so the two platform branches unify into ONE Effect type —
// a bare ternary returns a union of Effects, which breaks generic combinators
// like Effect.either at the call site.
export const runPlatformBuild = (input: PlatformBuildInput) =>
  Effect.gen(function* () {
    return input.platform === "ios"
      ? yield* runIosPlatformBuild(input)
      : yield* runAndroidPlatformBuild(input);
  });
