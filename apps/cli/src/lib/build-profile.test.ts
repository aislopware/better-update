import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { readAppMeta, readBuildProfile, readRuntimeVersionMeta } from "./build-profile";
import { BuildProfileError } from "./exit-codes";
import { failureError } from "./test-utils";

// ── fixtures ──────────────────────────────────────────────────────

const fullAppJson: Record<string, unknown> = {
  expo: {
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
  },
};

// ── readBuildProfile ──────────────────────────────────────────────

describe(readBuildProfile, () => {
  it.effect("returns production profile with ios + android", () =>
    Effect.gen(function* () {
      const profile = yield* readBuildProfile(fullAppJson, "production");
      expect(profile.name).toBe("production");
      expect(profile.environment).toBe("production");
      expect(profile.ios).toEqual({
        buildConfiguration: "Release",
        distribution: "app-store",
      });
      expect(profile.android).toEqual({
        buildType: "release",
        format: "aab",
        flavor: "prod",
        distribution: "play-store",
      });
    }),
  );

  it.effect("returns preview profile (different distribution + no flavor)", () =>
    Effect.gen(function* () {
      const profile = yield* readBuildProfile(fullAppJson, "preview");
      expect(profile.ios?.distribution).toBe("ad-hoc");
      expect(profile.android?.format).toBe("apk");
      expect(profile.android?.flavor).toBeUndefined();
      // apk defaults to "direct" distribution when not explicitly set
      expect(profile.android?.distribution).toBe("direct");
    }),
  );

  it.effect("android distribution defaults: aab → play-store, apk → direct", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
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
        },
      } as Record<string, unknown>;
      const aab = yield* readBuildProfile(appJson, "aab");
      const apk = yield* readBuildProfile(appJson, "apk");
      const explicit = yield* readBuildProfile(appJson, "explicit");
      expect(aab.android?.distribution).toBe("play-store");
      expect(apk.android?.distribution).toBe("direct");
      expect(explicit.android?.distribution).toBe("play-store");
    }),
  );

  it.effect("rejects ios distribution 'simulator' (returns no ios section)", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          extra: {
            betterUpdate: {
              profiles: {
                dev: { ios: { distribution: "simulator" } },
              },
            },
          },
        },
      } as Record<string, unknown>;
      const profile = yield* readBuildProfile(appJson, "dev");
      expect(profile.ios).toBeUndefined();
    }),
  );

  it.effect("fails with BuildProfileError when profile name missing", () =>
    Effect.gen(function* () {
      const exit = yield* readBuildProfile(fullAppJson, "missing").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildProfileError);
      }
    }),
  );

  it.effect("fails with BuildProfileError when no profiles are defined", () =>
    Effect.gen(function* () {
      const empty = { expo: { extra: { betterUpdate: {} } } } as Record<string, unknown>;
      const exit = yield* readBuildProfile(empty, "production").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("defaults environment to production when unspecified", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          extra: {
            betterUpdate: {
              profiles: {
                default: { ios: { distribution: "app-store" } },
              },
            },
          },
        },
      } as Record<string, unknown>;
      const profile = yield* readBuildProfile(appJson, "default");
      expect(profile.environment).toBe("production");
    }),
  );
});

// ── readRuntimeVersionMeta ────────────────────────────────────────

describe(readRuntimeVersionMeta, () => {
  it.effect("reads runtime version inputs without native platform sections", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          version: "1.0.0",
          runtimeVersion: { policy: "fingerprint" },
        },
      } as Record<string, unknown>;
      const meta = yield* readRuntimeVersionMeta(appJson);
      expect(meta).toEqual({
        appVersion: "1.0.0",
        rawRuntimeVersion: { policy: "fingerprint" },
      });
    }),
  );

  it.effect("fails when expo section is missing", () =>
    Effect.gen(function* () {
      const exit = yield* readRuntimeVersionMeta({}).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildProfileError);
      }
    }),
  );
});

// ── readAppMeta ───────────────────────────────────────────────────

describe(readAppMeta, () => {
  it.effect("reads bundleId, appVersion and rawRuntimeVersion for ios", () =>
    Effect.gen(function* () {
      const meta = yield* readAppMeta(fullAppJson, "ios");
      expect(meta.bundleId).toBe("com.example.app");
      expect(meta.appVersion).toBe("1.2.0");
      expect(meta.rawRuntimeVersion).toEqual({ policy: "fingerprint" });
    }),
  );

  it.effect("reads androidPackage for android", () =>
    Effect.gen(function* () {
      const meta = yield* readAppMeta(fullAppJson, "android");
      expect(meta.androidPackage).toBe("com.example.app");
    }),
  );

  it.effect("returns string rawRuntimeVersion as-is", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          version: "2.0.0",
          runtimeVersion: "1.2.3",
          ios: { bundleIdentifier: "com.a" },
          android: { package: "com.a" },
        },
      } as Record<string, unknown>;
      const meta = yield* readAppMeta(appJson, "ios");
      expect(meta.rawRuntimeVersion).toBe("1.2.3");
    }),
  );

  it.effect("fails when expo.ios section missing for ios platform", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: { version: "1.0.0", android: { package: "com.a" } },
      } as Record<string, unknown>;
      const exit = yield* readAppMeta(appJson, "ios").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildProfileError);
      }
    }),
  );

  it.effect("fails when expo.android section missing for android platform", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: { version: "1.0.0", ios: { bundleIdentifier: "com.a" } },
      } as Record<string, unknown>;
      const exit = yield* readAppMeta(appJson, "android").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("reads iOS buildNumber from expo.ios.buildNumber", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          version: "1.0.0",
          ios: { bundleIdentifier: "com.a", buildNumber: "42" },
          android: { package: "com.a" },
        },
      } as Record<string, unknown>;
      const meta = yield* readAppMeta(appJson, "ios");
      expect(meta.buildNumber).toBe("42");
    }),
  );

  it.effect("reads Android buildNumber from expo.android.versionCode (numeric)", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          version: "1.0.0",
          ios: { bundleIdentifier: "com.a" },
          android: { package: "com.a", versionCode: 7 },
        },
      } as Record<string, unknown>;
      const meta = yield* readAppMeta(appJson, "android");
      expect(meta.buildNumber).toBe("7");
    }),
  );

  it.effect("buildNumber is undefined when absent", () =>
    Effect.gen(function* () {
      const appJson = {
        expo: {
          version: "1.0.0",
          ios: { bundleIdentifier: "com.a" },
          android: { package: "com.a" },
        },
      } as Record<string, unknown>;
      const meta = yield* readAppMeta(appJson, "ios");
      expect(meta.buildNumber).toBeUndefined();
    }),
  );
});
