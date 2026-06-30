import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { setEnvVars } from "./dotenv-file";
import { printHuman } from "./output";

import type { OutputMode } from "./output-mode";

/**
 * Does the staged project consume a root `.env` at native-build time via
 * react-native-config? Only those projects need env materialization:
 *
 * - Expo reads `process.env` / app.config and regenerates native at prebuild.
 * - A bare project WITHOUT react-native-config reads its config another way
 *   (process.env injection / hardcoded), so writing a stray `.env` there could
 *   shadow unrelated config — leave it untouched.
 *
 * react-native-config is always a direct dependency when used, so package.json is
 * the reliable signal. Mirrors `hasExpoDependency` in detect-project-type.ts; a
 * missing/unparseable package.json is treated as "no".
 */
export const usesReactNativeConfig = (
  projectRoot: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(path.join(projectRoot, "package.json"))
      .pipe(Effect.orElseSucceed(() => ""));
    if (text.length === 0) {
      return false;
    }
    const parsed = yield* Effect.try((): unknown => JSON.parse(text)).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const pkg = asRecord(parsed);
    const deps = asRecord(pkg?.["dependencies"]);
    const devDeps = asRecord(pkg?.["devDependencies"]);
    return (
      deps?.["react-native-config"] !== undefined || devDeps?.["react-native-config"] !== undefined
    );
  });

export interface MaterializeEnvFileParams {
  /** Staging project root (contains `package.json` and the `.env` to write). */
  readonly projectRoot: string;
  /** User-defined env vars to materialize (decrypted remote vars + profile.env). */
  readonly envVars: Record<string, string>;
}

/**
 * Materialize the decrypted environment into the staged project's `.env` so a
 * bare react-native-config build reads the SAME values the Expo path gets via
 * `process.env`. react-native-config reads the `.env` FILE at build time (not
 * `process.env`), so without this a bare project would ship with whatever `.env`
 * was committed (or none) regardless of the server's environment.
 *
 * Supports both bare shapes:
 * - WITH react-native-config → values are merged into `.env` (server wins on a
 *   key collision; any committed local-only keys are preserved).
 * - WITHOUT react-native-config → no-op; the build still gets the env via the
 *   existing process.env injection, so nothing is lost and no stray file appears.
 *
 * Best-effort and non-fatal. Expo never reaches here (the caller gates on
 * non-Expo). An empty env set is a clean no-op, so this is safe to ship before
 * the server's env-vault is populated.
 */
export const materializeEnvFile = (
  params: MaterializeEnvFileParams,
): Effect.Effect<void, never, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    const entries = Object.entries(params.envVars);
    if (entries.length === 0) {
      return;
    }
    const uses = yield* usesReactNativeConfig(params.projectRoot);
    if (!uses) {
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    const envPath = path.join(params.projectRoot, ".env");
    const current = yield* fs.readFileString(envPath).pipe(Effect.orElseSucceed(() => ""));
    const next = setEnvVars(current, entries);
    if (next === current) {
      return;
    }
    yield* fs.writeFileString(envPath, next).pipe(Effect.orElseSucceed(() => undefined));
    yield* printHuman(
      `Materialized ${String(entries.length)} environment variable(s) into .env for react-native-config.`,
    );
  });
