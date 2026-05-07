import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { readBuildProfile, readRuntimeVersionMeta } from "./build-profile";
import { BuildProfileError } from "./exit-codes";
import { readAppMeta } from "./expo-config";
import { failureError } from "./test-utils";

import type { ExpoConfig } from "./expo-config";

// ── fixtures ──────────────────────────────────────────────────────

const fullConfig: ExpoConfig = {
  name: "my-app",
  version: "1.2.0",
  runtimeVersion: { policy: "fingerprint" },
  ios: { bundleIdentifier: "com.example.app" },
  android: { package: "com.example.app" },
  extra: {
    betterUpdate: {
      projectId: "proj_123",
      profiles: {
        development: {
          environment: "development",
          ios: { buildConfiguration: "Debug", distribution: "development" },
          android: { buildType: "debug", format: "apk" },
        },
        preview: {
          environment: "preview",
          ios: { buildConfiguration: "Release", distribution: "ad-hoc" },
          android: { buildType: "release", format: "apk" },
        },
        production: {
          environment: "production",
          ios: { buildConfiguration: "Release", distribution: "app-store" },
          android: { buildType: "release", format: "aab", flavor: "prod" },
        },
      },
    },
  },
};

// ── readBuildProfile ──────────────────────────────────────────────

describe(readBuildProfile, () => {
  it.effect("returns production profile with ios + android", () =>
    Effect.gen(function* () {
      const profile = yield* readBuildProfile(fullConfig, "production");
      expect(profile.name).toBe("production");
      expect(profile.environment).toBe("production");
      expect(profile.ios).toStrictEqual({
        buildConfiguration: "Release",
        distribution: "app-store",
      });
      expect(profile.android).toStrictEqual({
        buildType: "release",
        format: "aab",
        flavor: "prod",
        distribution: "play-store",
      });
    }),
  );

  it.effect("returns preview profile (different distribution + no flavor)", () =>
    Effect.gen(function* () {
      const profile = yield* readBuildProfile(fullConfig, "preview");
      expect(profile.ios?.distribution).toBe("ad-hoc");
      expect(profile.android?.format).toBe("apk");
      expect(profile.android?.flavor).toBeUndefined();
      // Apk defaults to "direct" distribution when not explicitly set
      expect(profile.android?.distribution).toBe("direct");
    }),
  );

  it.effect("android distribution defaults: aab → play-store, apk → direct", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        extra: {
          betterUpdate: {
            profiles: {
              aab: { android: { format: "aab", buildType: "release" } },
              apk: { android: { format: "apk", buildType: "release" } },
              explicit: {
                android: {
                  format: "apk",
                  buildType: "release",
                  distribution: "play-store",
                },
              },
            },
          },
        },
      };
      const aab = yield* readBuildProfile(config, "aab");
      const apk = yield* readBuildProfile(config, "apk");
      const explicit = yield* readBuildProfile(config, "explicit");
      expect(aab.android?.distribution).toBe("play-store");
      expect(apk.android?.distribution).toBe("direct");
      expect(explicit.android?.distribution).toBe("play-store");
    }),
  );

  it.effect("rejects ios distribution 'simulator' (returns no ios section)", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        extra: {
          betterUpdate: {
            profiles: {
              dev: { ios: { distribution: "simulator" } },
            },
          },
        },
      };
      const profile = yield* readBuildProfile(config, "dev");
      expect(profile.ios).toBeUndefined();
    }),
  );

  it.effect("fails with BuildProfileError when profile name missing", () =>
    Effect.gen(function* () {
      const exit = yield* readBuildProfile(fullConfig, "missing").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildProfileError);
      }
    }),
  );

  it.effect("fails with BuildProfileError when no profiles are defined", () =>
    Effect.gen(function* () {
      const empty: ExpoConfig = { extra: { betterUpdate: {} } };
      const exit = yield* readBuildProfile(empty, "production").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("defaults environment to production when unspecified", () =>
    Effect.gen(function* () {
      const config: ExpoConfig = {
        extra: {
          betterUpdate: {
            profiles: {
              default: { ios: { distribution: "app-store" } },
            },
          },
        },
      };
      const profile = yield* readBuildProfile(config, "default");
      expect(profile.environment).toBe("production");
    }),
  );
});

// ── readRuntimeVersionMeta ────────────────────────────────────────

describe(readRuntimeVersionMeta, () => {
  it("reads runtime version inputs without native platform sections", () => {
    const config: ExpoConfig = {
      version: "1.0.0",
      runtimeVersion: { policy: "fingerprint" },
    };
    const meta = readRuntimeVersionMeta(config);
    expect(meta).toStrictEqual({
      appVersion: "1.0.0",
      rawRuntimeVersion: { policy: "fingerprint" },
    });
  });

  it("returns undefined fields when both version and runtimeVersion are missing", () => {
    const meta = readRuntimeVersionMeta({});
    expect(meta).toStrictEqual({
      appVersion: undefined,
      rawRuntimeVersion: undefined,
    });
  });
});

// ── readAppMeta ───────────────────────────────────────────────────

describe(readAppMeta, () => {
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
