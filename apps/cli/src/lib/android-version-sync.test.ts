import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { applyAndroidVersion } from "./android-version-sync";
import { makeOutputModeLayer } from "./output-mode";

const testLayer = Layer.mergeAll(NodeFileSystem.layer, makeOutputModeLayer(false));

interface Project {
  readonly projectRoot: string;
  readonly gradlePath: string;
  readonly envPath: string;
  readonly dispose: () => void;
}

const setupProject = (buildGradle: string, env?: string): Project => {
  const projectRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "android-version-")));
  const appDir = path.join(projectRoot, "android", "app");
  mkdirSync(appDir, { recursive: true });
  const gradlePath = path.join(appDir, "build.gradle");
  writeFileSync(gradlePath, buildGradle);
  const envPath = path.join(projectRoot, ".env");
  if (env !== undefined) {
    writeFileSync(envPath, env);
  }
  return {
    projectRoot,
    gradlePath,
    envPath,
    dispose: () => rmSync(projectRoot, { recursive: true, force: true }),
  };
};

const LITERAL_GRADLE = `android {
    defaultConfig {
        applicationId "com.example.app"
        versionCode 16
        versionName "6.0.3"
    }
}
`;

const RN_CONFIG_GRADLE = `android {
    defaultConfig {
        applicationId project.env.get("APP_ID")
        versionCode project.env.get("VERSION_CODE_APP").toInteger()
        versionName project.env.get("VERSION_NAME_APP")
    }
}
`;

describe(applyAndroidVersion, () => {
  it.effect("patches literal versionCode / versionName in build.gradle", () =>
    Effect.gen(function* () {
      const project = setupProject(LITERAL_GRADLE);
      try {
        yield* applyAndroidVersion({
          projectRoot: project.projectRoot,
          versionName: "6.0.4",
          versionCode: "17",
        });
        const gradle = readFileSync(project.gradlePath, "utf8");
        expect(gradle).toContain("versionCode 17");
        expect(gradle).toContain(`versionName "6.0.4"`);
        expect(gradle).not.toContain("versionCode 16");
        expect(gradle).not.toContain(`versionName "6.0.3"`);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("writes react-native-config env keys into .env, leaving build.gradle untouched", () =>
    Effect.gen(function* () {
      const project = setupProject(
        RN_CONFIG_GRADLE,
        "APP_ID=com.example.app\nVERSION_CODE_APP=16\n",
      );
      try {
        const before = readFileSync(project.gradlePath, "utf8");
        yield* applyAndroidVersion({
          projectRoot: project.projectRoot,
          versionName: "6.0.4",
          versionCode: "17",
        });
        const env = readFileSync(project.envPath, "utf8");
        // Existing key is replaced in place; missing key is appended.
        expect(env).toContain("VERSION_CODE_APP=17");
        expect(env).toContain("VERSION_NAME_APP=6.0.4");
        expect(env).not.toContain("VERSION_CODE_APP=16");
        // Unrelated keys are preserved.
        expect(env).toContain("APP_ID=com.example.app");
        // The dynamic gradle is not rewritten.
        expect(readFileSync(project.gradlePath, "utf8")).toBe(before);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("creates .env when react-native-config keys are referenced but no file exists", () =>
    Effect.gen(function* () {
      const project = setupProject(RN_CONFIG_GRADLE);
      try {
        yield* applyAndroidVersion({
          projectRoot: project.projectRoot,
          versionName: "6.0.4",
          versionCode: "17",
        });
        const env = readFileSync(project.envPath, "utf8");
        expect(env).toContain("VERSION_CODE_APP=17");
        expect(env).toContain("VERSION_NAME_APP=6.0.4");
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("is a no-op when neither version is provided", () =>
    Effect.gen(function* () {
      const project = setupProject(LITERAL_GRADLE);
      try {
        const before = readFileSync(project.gradlePath, "utf8");
        yield* applyAndroidVersion({ projectRoot: project.projectRoot });
        expect(readFileSync(project.gradlePath, "utf8")).toBe(before);
      } finally {
        project.dispose();
      }
    }).pipe(Effect.provide(testLayer)),
  );
});
