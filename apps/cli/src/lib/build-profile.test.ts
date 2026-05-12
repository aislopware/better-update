import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { fromEasProfile, readRuntimeVersionMeta } from "./build-profile";
import { BuildProfileError } from "./exit-codes";
import { readAppMeta } from "./expo-config";
import { failureError } from "./test-utils";

import type { ExpoConfig } from "./expo-config";

// ── fromEasProfile (pure EAS→BuildProfile mapping) ────────────────

describe(fromEasProfile, () => {
  it("derives ios=ad-hoc + android=apk/direct from distribution=internal", () => {
    const profile = fromEasProfile({ distribution: "internal" }, "preview");
    expect(profile.name).toBe("preview");
    expect(profile.environment).toBe("production");
    expect(profile.ios?.distribution).toBe("ad-hoc");
    expect(profile.android?.format).toBe("apk");
    expect(profile.android?.distribution).toBe("direct");
  });

  it("derives ios=app-store + android=aab/play-store from distribution=store", () => {
    const profile = fromEasProfile({ distribution: "store" }, "production");
    expect(profile.ios?.distribution).toBe("app-store");
    expect(profile.android?.format).toBe("aab");
    expect(profile.android?.distribution).toBe("play-store");
  });

  it("derives ios=development from developmentClient=true", () => {
    const profile = fromEasProfile({ developmentClient: true }, "development");
    expect(profile.ios?.distribution).toBe("development");
    expect(profile.android?.format).toBe("apk");
  });

  it("ios.distribution override takes precedence over distribution+developmentClient", () => {
    const profile = fromEasProfile(
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
    const profile = fromEasProfile(
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
    const profile = fromEasProfile({ android: { format: "apk" } }, "android-only");
    expect(profile.ios).toBeUndefined();
    expect(profile.android?.format).toBe("apk");
  });

  it("returns no android section when only ios is intended", () => {
    const profile = fromEasProfile({ ios: { distribution: "app-store" } }, "ios-only");
    expect(profile.ios?.distribution).toBe("app-store");
    expect(profile.android).toBeUndefined();
  });

  it("propagates channel + env from the EAS profile", () => {
    const profile = fromEasProfile(
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

  it("uses the EAS profile's environment when set, else defaults to production", () => {
    const explicit = fromEasProfile({ environment: "development" }, "dev");
    expect(explicit.environment).toBe("development");
    const defaulted = fromEasProfile({ distribution: "internal" }, "noenv");
    expect(defaulted.environment).toBe("production");
  });

  it("propagates ios.simulator + ios.scheme + ios.buildConfiguration", () => {
    const profile = fromEasProfile(
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
    const profile = fromEasProfile(
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
