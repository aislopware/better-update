import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

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

const hasAnyExpoConfigFile = (projectRoot: string) =>
  Effect.gen(function* () {
    for (const name of ["app.json", "app.config.js", "app.config.ts"]) {
      if (yield* exists(path.join(projectRoot, name))) {
        return true;
      }
    }
    return false;
  });

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
      ((yield* hasExpoDependency(projectRoot)) || (yield* hasAnyExpoConfigFile(projectRoot)))
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
