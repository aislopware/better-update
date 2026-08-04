import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";

import { NodeContext } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { fromGenericProfile } from "../lib/build-profile";
import { makeOutputModeLayer } from "../lib/output-mode";
import { resolveNativeBuildMeta } from "./resolve-native-build-meta";

const TestLayer = Layer.mergeAll(NodeContext.layer, makeOutputModeLayer(false));

/**
 * A non-Expo project tree. `expoUpdates` and `appJson` vary independently
 * because the whole point of this module is that those two are separate
 * questions — and that neither one alone is enough.
 */
const makeProject = (options: {
  readonly expoUpdates: boolean;
  readonly appJson?: Record<string, unknown> | undefined;
}): { readonly dir: string; readonly dispose: () => void } => {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "bu-native-build-meta-"));
  writeFileSync(
    nodePath.join(dir, "package.json"),
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      dependencies: options.expoUpdates ? { "expo-updates": "~29.0.0" } : { react: "19.1.0" },
    }),
  );
  if (options.appJson !== undefined) {
    writeFileSync(nodePath.join(dir, "app.json"), JSON.stringify(options.appJson));
  }
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

/** Android metadata comes from the profile override, as it does for KMP/native. */
const profile = fromGenericProfile(
  {
    android: {
      format: "aab",
      distribution: "play-store",
      applicationId: "com.example.app",
      versionCode: "7",
    },
  },
  "production",
);

const resolve = (dir: string) =>
  resolveNativeBuildMeta({
    userCwd: dir,
    platform: "android",
    profile,
    projectType: "bare",
    envVars: {},
  });

describe(resolveNativeBuildMeta, () => {
  // The regression this guards: `runtimeVersion` used to be hard-coded to
  // `undefined` for every non-Expo project type, so a bare tree shipping
  // expo-updates uploaded a build record with no runtime version — which is
  // what made `builds compatibility-matrix` report "No compatibility data
  // found" across all 27 builds of the reported project.
  it.effect("derives the runtimeVersion for a bare project shipping expo-updates", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({
        expoUpdates: true,
        appJson: { expo: { name: "fixture", slug: "fixture", runtimeVersion: "1.0.0" } },
      });
      const meta = yield* resolve(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(meta.runtimeVersion).toBe("1.0.0");
      // App metadata still comes from the native/profile side, not the config.
      expect(meta.appMeta.androidPackage).toBe("com.example.app");
      expect(meta.appMeta.buildNumber).toBe("7");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("prefers the platform-specific runtimeVersion over the top-level one", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({
        expoUpdates: true,
        appJson: {
          expo: {
            name: "fixture",
            slug: "fixture",
            runtimeVersion: "1.0.0",
            android: { runtimeVersion: "2.0.0" },
          },
        },
      });
      const meta = yield* resolve(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(meta.runtimeVersion).toBe("2.0.0");
    }).pipe(Effect.provide(TestLayer)),
  );

  // The plain React Native template ships an `app.json`. Reading it for a
  // project that does no OTA is pure noise — and used to warn at the user.
  it.effect("ignores an app.json when the project does not depend on expo-updates", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({
        expoUpdates: false,
        appJson: { expo: { name: "fixture", slug: "fixture", runtimeVersion: "1.0.0" } },
      });
      const meta = yield* resolve(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(meta.runtimeVersion).toBeUndefined();
      expect(meta.appMeta.androidPackage).toBe("com.example.app");
    }).pipe(Effect.provide(TestLayer)),
  );

  // Best-effort by design: a missing runtimeVersion is the norm here, not a
  // misconfiguration, so it must not turn into a red build.
  it.effect("falls back to no runtimeVersion when the config declares none", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({
        expoUpdates: true,
        appJson: { expo: { name: "fixture", slug: "fixture" } },
      });
      const meta = yield* resolve(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(meta.runtimeVersion).toBeUndefined();
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("succeeds with no runtimeVersion when there is no Expo config at all", () =>
    Effect.gen(function* () {
      const { dir, dispose } = makeProject({ expoUpdates: true });
      const meta = yield* resolve(dir).pipe(Effect.ensuring(Effect.sync(dispose)));
      expect(meta.runtimeVersion).toBeUndefined();
    }).pipe(Effect.provide(TestLayer)),
  );
});
