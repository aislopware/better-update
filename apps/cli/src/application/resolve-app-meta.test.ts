import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import type { FileSystem } from "@effect/platform";

import { fromGenericProfile } from "../lib/build-profile";
import { BuildProfileError } from "../lib/exit-codes";
import { OutputModeLive } from "../lib/output-mode";
import { resolveAppMeta } from "./resolve-app-meta";

import type { AppMeta } from "../lib/build-profile";
import type { OutputMode } from "../lib/output-mode";

const TestLayer = Layer.merge(NodeFileSystem.layer, OutputModeLive);

const run = <Ok, Err>(effect: Effect.Effect<Ok, Err, FileSystem.FileSystem | OutputMode>) =>
  effect.pipe(Effect.provide(TestLayer));

describe(resolveAppMeta, () => {
  it.effect("uses android metaOverride when no build.gradle is present (KMP/custom)", () =>
    run(
      Effect.gen(function* () {
        const profile = fromGenericProfile(
          {
            android: {
              format: "aab",
              distribution: "play-store",
              applicationId: "com.acme.app",
              versionCode: "5",
            },
          },
          "p",
        );
        const meta = yield* resolveAppMeta({
          projectType: "kmp",
          platform: "android",
          projectRoot: "/nonexistent-root",
          profile,
        });
        expect(meta.androidPackage).toBe("com.acme.app");
        expect(meta.buildNumber).toBe("5");
      }),
    ),
  );

  it.effect("fails with an actionable error when the Android applicationId is unknown", () =>
    run(
      Effect.gen(function* () {
        const profile = fromGenericProfile(
          { android: { format: "aab", distribution: "play-store" } },
          "p",
        );
        const result = yield* resolveAppMeta({
          projectType: "native",
          platform: "android",
          projectRoot: "/nonexistent-root",
          profile,
        }).pipe(Effect.either);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(BuildProfileError);
          expect(result.left.message).toContain("android.applicationId");
        }
      }),
    ),
  );

  it.effect("uses ios metaOverride when the Xcode project can't be read", () =>
    run(
      Effect.gen(function* () {
        const profile = fromGenericProfile(
          {
            ios: { distribution: "app-store", bundleIdentifier: "com.acme.app", buildNumber: "9" },
          },
          "p",
        );
        const meta = yield* resolveAppMeta({
          projectType: "native",
          platform: "ios",
          projectRoot: "/nonexistent-root",
          profile,
        });
        expect(meta.bundleId).toBe("com.acme.app");
        expect(meta.buildNumber).toBe("9");
      }),
    ),
  );

  it.effect("overlays metaOverride onto the resolved Expo app metadata", () =>
    run(
      Effect.gen(function* () {
        const profile = fromGenericProfile(
          { ios: { distribution: "app-store", bundleIdentifier: "com.override" } },
          "p",
        );
        const expoAppMeta: AppMeta = {
          bundleId: "com.native",
          androidPackage: undefined,
          appVersion: "1.0.0",
          buildNumber: "1",
          rawRuntimeVersion: undefined,
        };
        const meta = yield* resolveAppMeta({
          projectType: "expo",
          platform: "ios",
          projectRoot: "/whatever",
          profile,
          expoAppMeta,
        });
        expect(meta.bundleId).toBe("com.override");
        expect(meta.appVersion).toBe("1.0.0");
      }),
    ),
  );
});
