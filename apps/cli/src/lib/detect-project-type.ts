import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import { isExpoConfigInstalled } from "./expo-config";

/**
 * Build-system family of a project. Decides how `build` prepares native sources
 * and reads app metadata:
 * - `expo`   — managed/prebuild flow (runs `expo prebuild`, reads app.json)
 * - `bare`   — bare React Native (android/ + ios/ committed; no prebuild)
 * - `kmp`    — Kotlin Multiplatform / Compose Multiplatform
 * - `native` — pure native Android (Gradle) and/or iOS (Xcode)
 * - `custom` — user-supplied build command (escape hatch); only via override
 */
export type ProjectType = "expo" | "bare" | "kmp" | "native" | "custom";

const PROJECT_TYPES: readonly ProjectType[] = ["expo", "bare", "kmp", "native", "custom"];

/** Narrow an arbitrary `projectType` override (e.g. from eas.json) to a valid value. */
export const asProjectType = (raw: unknown): ProjectType | undefined =>
  PROJECT_TYPES.find((type) => type === raw);

const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
  });

const readText = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
  });

const hasExpoDependency = (projectRoot: string) =>
  Effect.gen(function* () {
    const text = yield* readText(path.join(projectRoot, "package.json"));
    if (text.length === 0) {
      return false;
    }
    const parsed = yield* Effect.try((): unknown => JSON.parse(text)).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const pkg = asRecord(parsed);
    const deps = asRecord(pkg?.["dependencies"]);
    const devDeps = asRecord(pkg?.["devDependencies"]);
    return deps?.["expo"] !== undefined || devDeps?.["expo"] !== undefined;
  });

/**
 * Config files that make a project look Expo-MANAGED.
 *
 * Deliberately NARROWER than the set `@expo/config` can load, and deliberately
 * frozen: `detectProjectType` decides from this whether to run
 * `expo prebuild --clean`, so adding an entry here reclassifies real projects
 * and throws away their committed `android/` + `ios/`. Widening the OTA gate is
 * not a reason to touch this list — see `EXPO_CONFIG_FILES` below.
 */
const PROJECT_TYPE_CONFIG_FILES = ["app.json", "app.config.js", "app.config.ts"] as const;

/**
 * Every config file `@expo/config` resolves: the static forms plus each
 * dynamic-config extension in its `DYNAMIC_CONFIG_EXTS`. Kept in sync with that
 * list so the OTA gate below can never report "no config" for a file
 * `readExpoConfig` would have loaded.
 */
const EXPO_CONFIG_FILES = [
  "app.json",
  "app.config.json",
  "app.config.ts",
  "app.config.mts",
  "app.config.cts",
  "app.config.mjs",
  "app.config.cjs",
  "app.config.js",
] as const;

const hasAnyOf = (projectRoot: string, names: readonly string[]) =>
  Effect.gen(function* () {
    for (const name of names) {
      if (yield* exists(path.join(projectRoot, name))) {
        return true;
      }
    }
    return false;
  });

/**
 * Whether the project carries an Expo config file `@expo/config` could load.
 *
 * Exported because "can we read an Expo config?" is a DIFFERENT question from
 * "is this an Expo-managed project?". Conflating the two is what made
 * bare/native/custom projects silently lose their OTA runtimeVersion and their
 * update channel: both were gated on `projectType === "expo"` (or on the build
 * strategy) even though reading `app.json` never requires prebuild. Callers
 * that only need config DATA should gate on this, not on the project type.
 *
 * A truthy result is NOT sufficient reason to read the config: the plain React
 * Native template ships an `app.json` too. Pair it with a signal that the
 * project wants OTA at all (`isExpoUpdatesInstalled`).
 */
export const hasAnyExpoConfigFile = (projectRoot: string) =>
  hasAnyOf(projectRoot, EXPO_CONFIG_FILES);

const looksKmp = (projectRoot: string) =>
  Effect.gen(function* () {
    if (yield* exists(path.join(projectRoot, "composeApp"))) {
      return true;
    }
    for (const name of ["settings.gradle.kts", "settings.gradle"]) {
      const text = yield* readText(path.join(projectRoot, name));
      if (text.includes("composeApp") || text.includes(":shared")) {
        return true;
      }
    }
    // A Kotlin-DSL Android module without an Expo config is most likely KMP.
    return yield* exists(path.join(projectRoot, "android", "app", "build.gradle.kts"));
  });

export interface DetectProjectTypeParams {
  readonly projectRoot: string;
  /** Explicit override (e.g. eas.json `projectType`); wins unconditionally. */
  readonly override?: ProjectType | undefined;
}

/**
 * Resolve a project's build-system family. An explicit override always wins;
 * otherwise the filesystem shape is inspected. `custom` is never auto-detected —
 * it is intent expressed via override or a profile `custom` block.
 */
export const detectProjectType = (
  params: DetectProjectTypeParams,
): Effect.Effect<ProjectType, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (params.override !== undefined) {
      return params.override;
    }
    const { projectRoot } = params;

    const expoInstalled = isExpoConfigInstalled();
    if (
      expoInstalled &&
      ((yield* hasExpoDependency(projectRoot)) ||
        (yield* hasAnyOf(projectRoot, PROJECT_TYPE_CONFIG_FILES)))
    ) {
      return "expo";
    }

    if (yield* looksKmp(projectRoot)) {
      return "kmp";
    }

    const hasAndroid = yield* exists(path.join(projectRoot, "android"));
    const hasIos = yield* exists(path.join(projectRoot, "ios"));
    const hasPackageJson = yield* exists(path.join(projectRoot, "package.json"));

    if (hasAndroid && hasIos && hasPackageJson) {
      return "bare";
    }

    // A single native platform, or native dirs without a JS package — pure native.
    return "native";
  });
