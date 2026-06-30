import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { setEnvVar } from "./dotenv-file";
import { printHuman } from "./output";
import { printWarn } from "./warning-style";

import type { OutputMode } from "./output-mode";

export interface ApplyAndroidVersionParams {
  /** Staging project root (the directory that contains `android/` and `.env`). */
  readonly projectRoot: string;
  /** Resolved `versionName` to materialize (e.g. "6.0.4"); undefined skips it. */
  readonly versionName?: string | undefined;
  /** Resolved `versionCode` to materialize (e.g. "17"); undefined skips it. */
  readonly versionCode?: string | undefined;
}

// Literal forms: `versionCode 17` / `versionName "6.0.4"`.
const CODE_LITERAL = /\bversionCode\s+(?<code>\d+)/u;
const NAME_LITERAL = /\bversionName\s+(?<quote>["'])(?<name>[^"'\n]*)\k<quote>/u;
// react-native-config forms: `versionCode project.env.get("VERSION_CODE_APP").toInteger()`.
const CODE_ENV = /\bversionCode\b[^\n]*?\.env\.get\(\s*["'](?<key>[^"']+)["']\s*\)/u;
const NAME_ENV = /\bversionName\b[^\n]*?\.env\.get\(\s*["'](?<key>[^"']+)["']\s*\)/u;

type EnvKey = readonly [key: string, value: string];

interface VersionPlan {
  /** build.gradle content after patching any literals in place. */
  readonly gradle: string;
  /** `.env` keys to write for react-native-config env-driven values. */
  readonly envKeys: readonly EnvKey[];
  /** Fields that matched neither a literal nor an env reference. */
  readonly unresolved: readonly string[];
}

interface FieldOutcome {
  readonly gradle: string;
  readonly envKey?: EnvKey;
  readonly matched: boolean;
}

/**
 * Materialize one version field: patch a `build.gradle` literal in place, or
 * collect the referenced `.env` key when the value is `project.env.get(...)`.
 */
const planField = (
  gradle: string,
  literal: RegExp,
  env: RegExp,
  value: string,
  rewriteLiteral: (match: string) => string,
): FieldOutcome => {
  if (literal.test(gradle)) {
    return { gradle: gradle.replace(literal, rewriteLiteral), matched: true };
  }
  const key = env.exec(gradle)?.groups?.["key"];
  if (key !== undefined) {
    return { gradle, envKey: [key, value], matched: true };
  }
  return { gradle, matched: false };
};

/** Plan both version fields against the build.gradle content. */
const planVersions = (gradle: string, params: ApplyAndroidVersionParams): VersionPlan => {
  const envKeys: EnvKey[] = [];
  const unresolved: string[] = [];
  let next = gradle;

  const apply = (
    value: string | undefined,
    literal: RegExp,
    env: RegExp,
    kind: "versionCode" | "versionName",
  ): void => {
    if (value === undefined) {
      return;
    }
    const rewriteLiteral =
      kind === "versionCode"
        ? (): string => `versionCode ${value}`
        : (match: string): string =>
            match.replace(
              NAME_LITERAL,
              (_full, quote: string) => `versionName ${quote}${value}${quote}`,
            );
    const outcome = planField(next, literal, env, value, rewriteLiteral);
    next = outcome.gradle;
    if (outcome.envKey) {
      envKeys.push(outcome.envKey);
    } else if (!outcome.matched) {
      unresolved.push(kind);
    }
  };

  apply(params.versionCode, CODE_LITERAL, CODE_ENV, "versionCode");
  apply(params.versionName, NAME_LITERAL, NAME_ENV, "versionName");

  return { gradle: next, envKeys, unresolved };
};

const writeEnvKeys = (envPath: string, envKeys: readonly EnvKey[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const current = yield* fs.readFileString(envPath).pipe(Effect.orElseSucceed(() => ""));
    const next = envKeys.reduce((acc, [key, value]) => setEnvVar(acc, key, value), current);
    yield* fs.writeFileString(envPath, next).pipe(Effect.orElseSucceed(() => undefined));
  });

const reportResult = (
  params: ApplyAndroidVersionParams,
  patchedGradle: boolean,
  envKeys: readonly EnvKey[],
) => {
  const summary = [
    ...(params.versionName === undefined ? [] : [`versionName=${params.versionName}`]),
    ...(params.versionCode === undefined ? [] : [`versionCode=${params.versionCode}`]),
  ].join(", ");
  const where = [
    ...(patchedGradle ? ["build.gradle"] : []),
    ...(envKeys.length === 0 ? [] : [`.env (${envKeys.map(([key]) => key).join(", ")})`]),
  ].join(" + ");
  return printHuman(`Applied eas.json version (${summary}) to ${where}`);
};

/**
 * Materialize an eas.json Android version / versionCode override into the staged
 * project so the built APK/AAB matches eas.json. Two shapes are supported:
 *
 * - Literal `versionCode` / `versionName` in `android/app/build.gradle` → the
 *   literal is patched in place.
 * - react-native-config `project.env.get("KEY")` → the referenced key is written
 *   into the staged `.env`, which the dotenv.gradle reader consumes at build time.
 *
 * Best-effort and non-fatal: a project whose version is wired some other way is
 * left untouched with a warning, never failing the build. Expo and custom builds
 * never reach here (the caller gates on non-Expo, native-strategy builds).
 */
export const applyAndroidVersion = (
  params: ApplyAndroidVersionParams,
): Effect.Effect<void, never, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    if (params.versionName === undefined && params.versionCode === undefined) {
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    const gradlePath = path.join(params.projectRoot, "android", "app", "build.gradle");
    const original = yield* fs
      .readFileString(gradlePath)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (original === undefined) {
      yield* printWarn(
        `Could not read ${gradlePath} to apply the eas.json version override — leaving native version as-is.`,
      );
      return;
    }

    const plan = planVersions(original, params);
    const patchedGradle = plan.gradle !== original;

    if (patchedGradle) {
      yield* fs
        .writeFileString(gradlePath, plan.gradle)
        .pipe(Effect.orElseSucceed(() => undefined));
    }
    if (plan.envKeys.length > 0) {
      yield* writeEnvKeys(path.join(params.projectRoot, ".env"), plan.envKeys);
    }
    if (patchedGradle || plan.envKeys.length > 0) {
      yield* reportResult(params, patchedGradle, plan.envKeys);
    }
    if (plan.unresolved.length > 0) {
      yield* printWarn(
        `Could not locate ${plan.unresolved.join(" / ")} in android/app/build.gradle ` +
          "(no literal or react-native-config `project.env.get(...)` form found) — " +
          "the built artifact may not reflect the eas.json version.",
      );
    }
  });
