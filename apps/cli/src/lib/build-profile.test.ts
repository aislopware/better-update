import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { fromGenericProfile, readRuntimeVersionMeta } from "./build-profile";
import { BuildProfileError } from "./exit-codes";
import { readAppMeta } from "./expo-config";
import { failureError } from "./test-utils";

import type { ExpoConfig } from "./expo-config";

// ── fromGenericProfile (pure EAS→BuildProfile mapping) ────────────────

describe(fromGenericProfile, () => {
  it("derives ios=ad-hoc + android=apk/direct from distribution=internal", () => {
    const profile = fromGenericProfile({ distribution: "internal" }, "preview");
    expect(profile.name).toBe("preview");
    expect(profile.environment).toBe("production");
    expect(profile.ios?.distribution).toBe("ad-hoc");
    expect(profile.android?.format).toBe("apk");
    expect(profile.android?.distribution).toBe("direct");
  });

  it("derives ios=app-store + android=aab/play-store from distribution=store", () => {
    const profile = fromGenericProfile({ distribution: "store" }, "production");
    expect(profile.ios?.distribution).toBe("app-store");
    expect(profile.android?.format).toBe("aab");
    expect(profile.android?.distribution).toBe("play-store");
  });

  it("derives ios=development from developmentClient=true", () => {
    const profile = fromGenericProfile({ developmentClient: true }, "development");
    expect(profile.ios?.distribution).toBe("development");
    expect(profile.android?.format).toBe("apk");
  });

  it("developmentClient=true defaults ios.buildConfiguration to Debug and android.buildType to debug", () => {
    const profile = fromGenericProfile({ developmentClient: true }, "development");
    expect(profile.ios?.buildConfiguration).toBe("Debug");
    expect(profile.android?.buildType).toBe("debug");
    expect(profile.developmentClient).toBe(true);
  });

  it("explicit ios.buildConfiguration overrides the developmentClient Debug default", () => {
    const profile = fromGenericProfile(
      {
        developmentClient: true,
        ios: { buildConfiguration: "Release" },
      },
      "dev-release",
    );
    expect(profile.ios?.buildConfiguration).toBe("Release");
  });

  it("explicit android.buildType overrides the developmentClient debug default", () => {
    const profile = fromGenericProfile(
      {
        developmentClient: true,
        android: { buildType: "release" },
      },
      "dev-release",
    );
    expect(profile.android?.buildType).toBe("release");
  });

  it("non-dev profile leaves buildConfiguration/buildType undefined for runtime defaults", () => {
    const profile = fromGenericProfile({ distribution: "store" }, "production");
    expect(profile.ios?.buildConfiguration).toBeUndefined();
    expect(profile.android?.buildType).toBeUndefined();
    expect(profile.developmentClient).toBeUndefined();
  });

  it("threads withoutCredentials onto the resolved BuildProfile", () => {
    const profile = fromGenericProfile(
      { developmentClient: true, withoutCredentials: true },
      "dev-no-creds",
    );
    expect(profile.withoutCredentials).toBe(true);
  });

  it("ios.distribution override takes precedence over distribution+developmentClient", () => {
    const profile = fromGenericProfile(
      {
        distribution: "store",
        developmentClient: true,
        ios: { distribution: "enterprise" },
      },
      "enterprise",
    );
    expect(profile.ios?.distribution).toBe("enterprise");
  });

  it("android.format override takes precedence over distribution-derived default", () => {
    const profile = fromGenericProfile(
      {
        distribution: "store",
        android: { format: "apk", distribution: "direct" },
      },
      "preview-store",
    );
    expect(profile.android?.format).toBe("apk");
    expect(profile.android?.distribution).toBe("direct");
  });

  it("returns no ios section when no ios intent (no distribution / no ios / no developmentClient)", () => {
    const profile = fromGenericProfile({ android: { format: "apk" } }, "android-only");
    expect(profile.ios).toBeUndefined();
    expect(profile.android?.format).toBe("apk");
  });

  it("returns no android section when only ios is intended", () => {
    const profile = fromGenericProfile({ ios: { distribution: "app-store" } }, "ios-only");
    expect(profile.ios?.distribution).toBe("app-store");
    expect(profile.android).toBeUndefined();
  });

  it("propagates channel + env from the EAS profile", () => {
    const profile = fromGenericProfile(
      {
        distribution: "internal",
        channel: "preview",
        env: { API_URL: "https://staging.example" },
      },
      "preview",
    );
    expect(profile.channel).toBe("preview");
    expect(profile.env).toStrictEqual({ API_URL: "https://staging.example" });
  });

  it("maps generic iOS fields (workspace/project/podInstall) onto the profile", () => {
    const profile = fromGenericProfile(
      {
        ios: {
          distribution: "app-store",
          workspace: "ios/App.xcworkspace",
          project: "ios/App.xcodeproj",
          podInstall: false,
        },
      },
      "bare",
    );
    expect(profile.ios?.workspace).toBe("ios/App.xcworkspace");
    expect(profile.ios?.project).toBe("ios/App.xcodeproj");
    expect(profile.ios?.podInstall).toBe(false);
  });

  it("collects iOS metadata overrides into metaOverride (only when present)", () => {
    const withMeta = fromGenericProfile(
      { ios: { distribution: "app-store", bundleIdentifier: "com.acme.app", buildNumber: "42" } },
      "meta",
    );
    expect(withMeta.ios?.metaOverride).toStrictEqual({
      bundleIdentifier: "com.acme.app",
      buildNumber: "42",
    });
    const withoutMeta = fromGenericProfile({ ios: { distribution: "app-store" } }, "nometa");
    expect(withoutMeta.ios?.metaOverride).toBeUndefined();
  });

  it("maps generic Android fields (module/gradleTask) and metadata overrides", () => {
    const profile = fromGenericProfile(
      {
        android: {
          format: "aab",
          distribution: "play-store",
          module: "composeApp",
          gradleTask: "bundleRelease",
          applicationId: "com.acme.app",
          versionCode: "7",
        },
      },
      "kmp",
    );
    expect(profile.android?.module).toBe("composeApp");
    expect(profile.android?.gradleTask).toBe("bundleRelease");
    expect(profile.android?.metaOverride).toStrictEqual({
      applicationId: "com.acme.app",
      versionCode: "7",
    });
  });

  it("threads the custom-command block onto customCommand", () => {
    const profile = fromGenericProfile(
      {
        android: { format: "aab", distribution: "play-store" },
        custom: { android: { command: "./build.sh", artifactPath: "**/*.aab" } },
      },
      "custom",
    );
    expect(profile.customCommand?.android?.command).toBe("./build.sh");
    expect(profile.customCommand?.android?.artifactPath).toBe("**/*.aab");
  });

  it("uses the EAS profile's environment when set, else defaults to production", () => {
    const explicit = fromGenericProfile({ environment: "development" }, "dev");
    expect(explicit.environment).toBe("development");
    const defaulted = fromGenericProfile({ distribution: "internal" }, "noenv");
    expect(defaulted.environment).toBe("production");
  });

  it("propagates ios.simulator + ios.scheme + ios.buildConfiguration", () => {
    const profile = fromGenericProfile(
      {
        developmentClient: true,
        ios: { simulator: true, scheme: "Dev", buildConfiguration: "Debug" },
      },
      "sim",
    );
    expect(profile.ios?.simulator).toBe(true);
    expect(profile.ios?.scheme).toBe("Dev");
    expect(profile.ios?.buildConfiguration).toBe("Debug");
  });

  it("propagates android.buildType + flavor + gradleCommand", () => {
    const profile = fromGenericProfile(
      {
        distribution: "store",
        android: {
          buildType: "release",
          flavor: "prod",
          gradleCommand: ":app:bundleProdRelease",
        },
      },
      "prod-android",
    );
    expect(profile.android?.buildType).toBe("release");
    expect(profile.android?.flavor).toBe("prod");
    expect(profile.android?.gradleCommand).toBe(":app:bundleProdRelease");
  });

  it("resolves autoIncrement=true to buildNumber (ios) and versionCode (android)", () => {
    const profile = fromGenericProfile({ distribution: "store", autoIncrement: true }, "p");
    expect(profile.ios?.autoIncrement).toBe("buildNumber");
    expect(profile.android?.autoIncrement).toBe("versionCode");
  });

  it("resolves autoIncrement=version to version on both platforms", () => {
    const profile = fromGenericProfile({ distribution: "store", autoIncrement: "version" }, "p");
    expect(profile.ios?.autoIncrement).toBe("version");
    expect(profile.android?.autoIncrement).toBe("version");
  });

  it("top-level autoIncrement=buildNumber only applies to ios; android stays undefined", () => {
    const profile = fromGenericProfile(
      { distribution: "store", autoIncrement: "buildNumber" },
      "p",
    );
    expect(profile.ios?.autoIncrement).toBe("buildNumber");
    expect(profile.android?.autoIncrement).toBeUndefined();
  });

  it("top-level autoIncrement=versionCode only applies to android; ios stays undefined", () => {
    const profile = fromGenericProfile(
      { distribution: "store", autoIncrement: "versionCode" },
      "p",
    );
    expect(profile.ios?.autoIncrement).toBeUndefined();
    expect(profile.android?.autoIncrement).toBe("versionCode");
  });

  it("platform-scoped autoIncrement overrides top-level", () => {
    const profile = fromGenericProfile(
      {
        distribution: "store",
        autoIncrement: true,
        ios: { autoIncrement: "version" },
        android: { autoIncrement: false },
      },
      "p",
    );
    expect(profile.ios?.autoIncrement).toBe("version");
    expect(profile.android?.autoIncrement).toBeUndefined();
  });

  it("platform-scoped autoIncrement=false disables top-level even when truthy", () => {
    const profile = fromGenericProfile(
      {
        distribution: "store",
        autoIncrement: true,
        ios: { autoIncrement: false },
      },
      "p",
    );
    expect(profile.ios?.autoIncrement).toBeUndefined();
    expect(profile.android?.autoIncrement).toBe("versionCode");
  });
});

// ── readRuntimeVersionMeta ────────────────────────────────────────

describe(readRuntimeVersionMeta, () => {
  it("reads runtime version inputs without native platform sections", () => {
    const config: ExpoConfig = {
      version: "1.0.0",
      runtimeVersion: { policy: "fingerprint" },
    };
    const meta = readRuntimeVersionMeta(config, "ios");
    expect(meta).toStrictEqual({
      platform: "ios",
      appVersion: "1.0.0",
      buildNumber: undefined,
      sdkVersion: undefined,
      rawRuntimeVersion: { policy: "fingerprint" },
    });
  });

  it("reads the per-platform native version and sdkVersion", () => {
    const config: ExpoConfig = {
      version: "1.0.0",
      sdkVersion: "52.0.0",
      runtimeVersion: { policy: "nativeVersion" },
      ios: { bundleIdentifier: "com.example.app", buildNumber: "7" },
      android: { package: "com.example.app", versionCode: 9 },
    };
    expect(readRuntimeVersionMeta(config, "ios")).toStrictEqual({
      platform: "ios",
      appVersion: "1.0.0",
      buildNumber: "7",
      sdkVersion: "52.0.0",
      rawRuntimeVersion: { policy: "nativeVersion" },
    });
    expect(readRuntimeVersionMeta(config, "android")).toStrictEqual({
      platform: "android",
      appVersion: "1.0.0",
      buildNumber: "9",
      sdkVersion: "52.0.0",
      rawRuntimeVersion: { policy: "nativeVersion" },
    });
  });

  it("returns undefined fields when both version and runtimeVersion are missing", () => {
    const meta = readRuntimeVersionMeta({}, "ios");
    expect(meta).toStrictEqual({
      platform: "ios",
      appVersion: undefined,
      buildNumber: undefined,
      sdkVersion: undefined,
      rawRuntimeVersion: undefined,
    });
  });
});

// ── readAppMeta (kept here because it shares fixtures with build profile tests) ──

describe(readAppMeta, () => {
  const fullConfig: ExpoConfig = {
    name: "my-app",
    version: "1.2.0",
    runtimeVersion: { policy: "fingerprint" },
    ios: { bundleIdentifier: "com.example.app" },
    android: { package: "com.example.app" },
  };

  it.effect("reads bundleId, appVersion and rawRuntimeVersion for ios", () =>
    Effect.gen(function* () {
      const meta = yield* readAppMeta(fullConfig, "ios");
      expect(meta.bundleId).toBe("com.example.app");
      expect(meta.appVersion).toBe("1.2.0");
      expect(meta.rawRuntimeVersion).toStrictEqual({ policy: "fingerprint" });
    }),
  );

  it.effect("reads androidPackage for android", () =>
    Effect.gen(function* () {
      const meta = yield* readAppMeta(fullConfig, "android");
      expect(meta.androidPackage).toBe("com.example.app");
    }),
  );

  it.effect("returns string rawRuntimeVersion as-is", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        version: "2.0.0",
        runtimeVersion: "1.2.3",
        ios: { bundleIdentifier: "com.a" },
        android: { package: "com.a" },
      };
      const meta = yield* readAppMeta(config, "ios");
      expect(meta.rawRuntimeVersion).toBe("1.2.3");
    }),
  );

  it.effect("fails when ios section missing for ios platform", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = { version: "1.0.0", android: { package: "com.a" } };
      const exit = yield* readAppMeta(config, "ios").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildProfileError);
      }
    }),
  );

  it.effect("fails when android section missing for android platform", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = { version: "1.0.0", ios: { bundleIdentifier: "com.a" } };
      const exit = yield* readAppMeta(config, "android").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("reads iOS buildNumber from ios.buildNumber", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        version: "1.0.0",
        ios: { bundleIdentifier: "com.a", buildNumber: "42" },
        android: { package: "com.a" },
      };
      const meta = yield* readAppMeta(config, "ios");
      expect(meta.buildNumber).toBe("42");
    }),
  );

  it.effect("reads Android buildNumber from android.versionCode (numeric)", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        version: "1.0.0",
        ios: { bundleIdentifier: "com.a" },
        android: { package: "com.a", versionCode: 7 },
      };
      const meta = yield* readAppMeta(config, "android");
      expect(meta.buildNumber).toBe("7");
    }),
  );

  it.effect("buildNumber is undefined when absent", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        version: "1.0.0",
        ios: { bundleIdentifier: "com.a" },
        android: { package: "com.a" },
      };
      const meta = yield* readAppMeta(config, "ios");
      expect(meta.buildNumber).toBeUndefined();
    }),
  );
});
