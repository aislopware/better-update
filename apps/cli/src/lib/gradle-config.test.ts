import path from "node:path";

import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { readGradleConfig } from "./gradle-config";

const run = <Ok, Err>(effect: Effect.Effect<Ok, Err, FileSystem.FileSystem>) =>
  effect.pipe(Effect.provide(NodeFileSystem.layer));

/** Write `android/app/build.gradle` into a fresh temp dir and return the android dir. */
const withGradle = (content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectory();
    const appDir = path.join(root, "android", "app");
    yield* fs.makeDirectory(appDir, { recursive: true });
    yield* fs.writeFileString(path.join(appDir, "build.gradle"), content);
    return path.join(root, "android");
  });

describe(readGradleConfig, () => {
  it.effect("reads a static reverse-domain applicationId", () =>
    run(
      Effect.gen(function* () {
        const androidDir = yield* withGradle(
          `android {\n  defaultConfig {\n    applicationId "com.acme.app"\n    versionCode 7\n    versionName "1.2.3"\n  }\n}`,
        );
        const config = yield* readGradleConfig(androidDir);
        expect(config?.applicationId).toBe("com.acme.app");
        expect(config?.versionCode).toBe(7);
        expect(config?.versionName).toBe("1.2.3");
      }),
    ),
  );

  it.effect("treats an env-driven applicationId (react-native-config) as unresolved", () =>
    run(
      Effect.gen(function* () {
        const androidDir = yield* withGradle(
          `android {\n  defaultConfig {\n    applicationId project.env.get("APP_ID")\n    versionCode 9\n  }\n}`,
        );
        const config = yield* readGradleConfig(androidDir);
        // The raw Groovy expression is not a real package name — drop it so
        // callers fall back to the Expo/eas config value instead of failing.
        expect(config?.applicationId).toBeUndefined();
        // Other parseable fields still come through.
        expect(config?.versionCode).toBe(9);
      }),
    ),
  );

  it.effect("treats a `def` variable applicationId as unresolved", () =>
    run(
      Effect.gen(function* () {
        const androidDir = yield* withGradle(
          `def appId = "com.acme.app"\nandroid {\n  defaultConfig {\n    applicationId appId\n  }\n}`,
        );
        const config = yield* readGradleConfig(androidDir);
        expect(config?.applicationId).toBeUndefined();
      }),
    ),
  );

  it.effect("returns undefined when no build.gradle exists", () =>
    run(
      Effect.gen(function* () {
        const config = yield* readGradleConfig("/nonexistent-root/android");
        expect(config).toBeUndefined();
      }),
    ),
  );
});
