import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { parseEasConfig, resolveEasBuildProfile } from "./eas-config";
import { BuildProfileError } from "./exit-codes";
import { failureError } from "./test-utils";

describe(parseEasConfig, () => {
  it.effect("parses an empty object as a config with no profiles", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig("{}");
      expect(config.build).toBeUndefined();
    }),
  );

  it.effect("parses cli.version when present", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(`{"cli":{"version":">=1.0.0"}}`);
      expect(config.cli?.version).toBe(">=1.0.0");
    }),
  );

  it.effect("parses a single build profile with iOS distribution override", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            production: {
              environment: "production",
              ios: { distribution: "ad-hoc", buildConfiguration: "Release" },
            },
          },
        }),
      );
      expect(config.build?.["production"]?.environment).toBe("production");
      expect(config.build?.["production"]?.ios?.distribution).toBe("ad-hoc");
      expect(config.build?.["production"]?.ios?.buildConfiguration).toBe("Release");
    }),
  );

  it.effect("rejects unknown ios.distribution values silently (treats as undefined)", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            production: { ios: { distribution: "garbage" } },
          },
        }),
      );
      expect(config.build?.["production"]?.ios?.distribution).toBeUndefined();
    }),
  );

  it.effect("parses env vars in a profile", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            production: { env: { API_URL: "https://api.example.com", DEBUG: "0" } },
          },
        }),
      );
      expect(config.build?.["production"]?.env).toStrictEqual({
        API_URL: "https://api.example.com",
        DEBUG: "0",
      });
    }),
  );

  it.effect("fails on invalid JSON", () =>
    Effect.gen(function* () {
      const exit = yield* parseEasConfig("not json").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(BuildProfileError);
      }
    }),
  );

  it.effect("fails when top-level is not an object", () =>
    Effect.gen(function* () {
      const exit = yield* parseEasConfig(`["array"]`).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe(resolveEasBuildProfile, () => {
  it.effect("returns the profile when no extends chain", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            production: {
              environment: "production",
              distribution: "store",
              ios: { buildConfiguration: "Release" },
            },
          },
        }),
      );
      const profile = yield* resolveEasBuildProfile(config, "production");
      expect(profile.environment).toBe("production");
      expect(profile.distribution).toBe("store");
      expect(profile.ios?.buildConfiguration).toBe("Release");
    }),
  );

  it.effect("merges fields from an extended base profile (overlay wins)", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            base: {
              distribution: "store",
              ios: { buildConfiguration: "Release", scheme: "MyApp" },
              android: { buildType: "release" },
            },
            production: {
              extends: "base",
              environment: "production",
              channel: "production",
              ios: { buildConfiguration: "ReleaseSpecial" },
            },
          },
        }),
      );
      const profile = yield* resolveEasBuildProfile(config, "production");
      expect(profile.extends).toBeUndefined();
      expect(profile.environment).toBe("production");
      expect(profile.channel).toBe("production");
      expect(profile.distribution).toBe("store");
      expect(profile.ios?.buildConfiguration).toBe("ReleaseSpecial");
      expect(profile.ios?.scheme).toBe("MyApp");
      expect(profile.android?.buildType).toBe("release");
    }),
  );

  it.effect("resolves multi-level extends chains", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            root: { distribution: "internal" },
            mid: { extends: "root", environment: "preview" },
            leaf: { extends: "mid", channel: "preview" },
          },
        }),
      );
      const profile = yield* resolveEasBuildProfile(config, "leaf");
      expect(profile.distribution).toBe("internal");
      expect(profile.environment).toBe("preview");
      expect(profile.channel).toBe("preview");
    }),
  );

  it.effect("fails when the profile is missing", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(`{"build":{"production":{}}}`);
      const exit = yield* resolveEasBuildProfile(config, "missing").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("fails when extends points to a missing profile", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: { production: { extends: "missingBase" } },
        }),
      );
      const exit = yield* resolveEasBuildProfile(config, "production").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("detects an extends cycle", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            alpha: { extends: "beta" },
            beta: { extends: "alpha" },
          },
        }),
      );
      const exit = yield* resolveEasBuildProfile(config, "alpha").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error?.message).toContain("Cycle");
      }
    }),
  );

  it.effect("merges env records cumulatively across extends", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            base: { env: { COMMON: "1", OVERRIDE: "base" } },
            production: { extends: "base", env: { OVERRIDE: "prod", PROD_ONLY: "yes" } },
          },
        }),
      );
      const profile = yield* resolveEasBuildProfile(config, "production");
      expect(profile.env).toStrictEqual({
        COMMON: "1",
        OVERRIDE: "prod",
        PROD_ONLY: "yes",
      });
    }),
  );

  it.effect("fails when build section is missing", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(`{}`);
      const exit = yield* resolveEasBuildProfile(config, "production").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("parses top-level autoIncrement (boolean + string variants)", () =>
    Effect.gen(function* () {
      const trueConfig = yield* parseEasConfig(
        JSON.stringify({ build: { prod: { autoIncrement: true } } }),
      );
      expect(trueConfig.build?.["prod"]?.autoIncrement).toBe(true);

      const stringConfig = yield* parseEasConfig(
        JSON.stringify({ build: { prod: { autoIncrement: "version" } } }),
      );
      expect(stringConfig.build?.["prod"]?.autoIncrement).toBe("version");

      const invalidConfig = yield* parseEasConfig(
        JSON.stringify({ build: { prod: { autoIncrement: "garbage" } } }),
      );
      expect(invalidConfig.build?.["prod"]?.autoIncrement).toBeUndefined();
    }),
  );

  it.effect("parses platform-scoped autoIncrement override", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            prod: {
              ios: { autoIncrement: "buildNumber" },
              android: { autoIncrement: "versionCode" },
            },
          },
        }),
      );
      expect(config.build?.["prod"]?.ios?.autoIncrement).toBe("buildNumber");
      expect(config.build?.["prod"]?.android?.autoIncrement).toBe("versionCode");
    }),
  );

  it.effect("rejects invalid platform-scoped autoIncrement values silently", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            prod: {
              ios: { autoIncrement: "versionCode" },
              android: { autoIncrement: "buildNumber" },
            },
          },
        }),
      );
      // versionCode is not valid on ios; buildNumber is not valid on android
      expect(config.build?.["prod"]?.ios?.autoIncrement).toBeUndefined();
      expect(config.build?.["prod"]?.android?.autoIncrement).toBeUndefined();
    }),
  );

  it.effect("merges autoIncrement across extends chain (overlay wins)", () =>
    Effect.gen(function* () {
      const config = yield* parseEasConfig(
        JSON.stringify({
          build: {
            base: { autoIncrement: true },
            production: { extends: "base", autoIncrement: "version" },
          },
        }),
      );
      const profile = yield* resolveEasBuildProfile(config, "production");
      expect(profile.autoIncrement).toBe("version");
    }),
  );
});
