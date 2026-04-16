import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

export interface GradleConfig {
  readonly applicationId?: string;
  readonly versionCode?: number;
  readonly versionName?: string;
}

/**
 * Parse Groovy `build.gradle` to extract key Android config values.
 * Returns `undefined` if:
 * - Only `build.gradle.kts` exists (Kotlin DSL not supported by gradle-to-js)
 * - No build.gradle found at all
 * - Parse fails
 *
 * Informational only — never blocks the build.
 */
export const readGradleConfig = (
  androidDir: string,
): Effect.Effect<GradleConfig | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const gradlePath = path.join(androidDir, "app", "build.gradle");
    const ktsPath = path.join(androidDir, "app", "build.gradle.kts");

    const hasGroovy = yield* fs.exists(gradlePath).pipe(Effect.orElseSucceed(() => false));
    const hasKts = yield* fs.exists(ktsPath).pipe(Effect.orElseSucceed(() => false));

    if (!hasGroovy && hasKts) {
      // Kotlin DSL — gradle-to-js cannot parse it
      return undefined;
    }

    if (!hasGroovy) return undefined;

    const content = yield* fs
      .readFileString(gradlePath)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!content) return undefined;

    return yield* Effect.tryPromise({
      try: () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS-only module
        const gradle = require("gradle-to-js") as {
          parseText: (text: string) => Promise<Record<string, unknown>>;
        };
        return gradle.parseText(stripGroovyComments(content));
      },
      catch: () => undefined,
    }).pipe(
      Effect.map((parsed) => (parsed ? extractGradleConfig(parsed) : undefined)),
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
  });

/**
 * Log a warning if Gradle applicationId differs from app.json package name.
 */
export const warnOnGradleMismatch = (
  gradleConfig: GradleConfig | undefined,
  expectedPackage: string,
): Effect.Effect<void> => {
  if (!gradleConfig?.applicationId) return Effect.void;
  if (gradleConfig.applicationId === expectedPackage) return Effect.void;
  return Console.warn(
    `Gradle applicationId "${gradleConfig.applicationId}" differs from app.json package "${expectedPackage}". ` +
      `The Gradle value will be used in the built APK/AAB.`,
  );
};

// ── helpers ──────────────────────────────────────────────────────

/**
 * Strip Groovy single-line and block comments.
 * gradle-to-js chokes on comments — EAS CLI does this same pre-processing.
 */
const stripGroovyComments = (text: string): string =>
  text.replace(/\/\/.*$/gmu, "").replace(/\/\*[\s\S]*?\*\//gu, "");

const extractGradleConfig = (parsed: Record<string, unknown>): GradleConfig => {
  const android = parsed["android"] as Record<string, unknown> | undefined;
  const defaultConfig = android?.["defaultConfig"] as Record<string, unknown> | undefined;

  const applicationId =
    typeof defaultConfig?.["applicationId"] === "string"
      ? unquote(defaultConfig["applicationId"])
      : undefined;
  const versionCode =
    typeof defaultConfig?.["versionCode"] === "number"
      ? defaultConfig["versionCode"]
      : typeof defaultConfig?.["versionCode"] === "string"
        ? Number.parseInt(defaultConfig["versionCode"], 10) || undefined
        : undefined;
  const versionName =
    typeof defaultConfig?.["versionName"] === "string"
      ? unquote(defaultConfig["versionName"])
      : undefined;

  return {
    ...(applicationId !== undefined ? { applicationId } : {}),
    ...(versionCode !== undefined ? { versionCode } : {}),
    ...(versionName !== undefined ? { versionName } : {}),
  };
};

const unquote = (s: string): string => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);
