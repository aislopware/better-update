import path from "node:path";

import { asRecord } from "@better-update/type-guards";
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

    if (!hasGroovy) {
      return undefined;
    }

    const content = yield* fs
      .readFileString(gradlePath)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (!content) {
      return undefined;
    }

    return yield* Effect.tryPromise({
      try: async () => {
        const gradle =
          // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CJS require returns `any`; narrow to gradle-to-js declared shape
          require("gradle-to-js") as {
            parseText: (text: string) => Promise<Record<string, unknown>>;
          };
        return gradle.parseText(stripGroovyComments(content));
      },
      catch: () => undefined,
    }).pipe(
      Effect.map(extractGradleConfig),
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
  if (!gradleConfig?.applicationId) {
    return Effect.void;
  }
  if (gradleConfig.applicationId === expectedPackage) {
    return Effect.void;
  }
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
  text.replaceAll(/\/\/.*$/gmu, "").replaceAll(/\/\*[\s\S]*?\*\//gu, "");

const parseVersionCode = (raw: unknown): number | undefined => {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    return Number.parseInt(raw, 10) || undefined;
  }
  return undefined;
};

const extractGradleConfig = (parsed: Record<string, unknown>): GradleConfig => {
  const android = asRecord(parsed["android"]);
  const defaultConfig = asRecord(android?.["defaultConfig"]);

  const applicationId =
    typeof defaultConfig?.["applicationId"] === "string"
      ? unquote(defaultConfig["applicationId"])
      : undefined;
  const versionCode = parseVersionCode(defaultConfig?.["versionCode"]);
  const versionName =
    typeof defaultConfig?.["versionName"] === "string"
      ? unquote(defaultConfig["versionName"])
      : undefined;

  return {
    ...(applicationId === undefined ? {} : { applicationId }),
    ...(versionCode === undefined ? {} : { versionCode }),
    ...(versionName === undefined ? {} : { versionName }),
  };
};

const unquote = (input: string): string =>
  input.startsWith('"') && input.endsWith('"') ? input.slice(1, -1) : input;
