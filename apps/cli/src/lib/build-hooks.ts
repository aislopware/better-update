import path from "node:path";

import { isRecord } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { runStep } from "../commands/build/run-step";
import { printHuman } from "./output";

import type { BuildFailedError } from "./exit-codes";
import type { OutputMode } from "./output-mode";
import type { PackageManager } from "./project-staging";

/**
 * EAS Build lifecycle hooks (same npm-script names, for drop-in compat):
 * pre-install runs before `<pm> install` in staging, post-install after
 * prebuild/pods (iOS) or prebuild/install (Android), and the on-* hooks run
 * around the platform build with BETTER_UPDATE_BUILD_STATUS / EAS_BUILD_STATUS
 * set to `finished` | `errored`.
 */
export type BuildHookName =
  | "eas-build-pre-install"
  | "eas-build-post-install"
  | "eas-build-on-success"
  | "eas-build-on-error"
  | "eas-build-on-complete";

/** Extract the hook script from parsed package.json contents, if declared. */
export const hookScript = (packageJson: unknown, name: BuildHookName): string | undefined => {
  if (!isRecord(packageJson) || !isRecord(packageJson["scripts"])) {
    return undefined;
  }
  const value = packageJson["scripts"][name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

export interface RunBuildHookInput {
  readonly name: BuildHookName;
  /** Directory whose package.json declares the hook; also the hook's cwd. */
  readonly projectRoot: string;
  readonly packageManager: PackageManager;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Run an EAS-style lifecycle hook when the project's package.json declares it;
 * silently no-op otherwise. The pre-install hook runs with npm when the
 * package manager is yarn (mirrors EAS — `yarn run` fails before node_modules
 * exists).
 */
export const runBuildHook = (
  input: RunBuildHookInput,
): Effect.Effect<void, BuildFailedError, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs
      .readFileString(path.join(input.projectRoot, "package.json"))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (raw === undefined) {
      return;
    }
    if (hookScript(parseJson(raw), input.name) === undefined) {
      return;
    }
    const runner =
      input.name === "eas-build-pre-install" && input.packageManager === "yarn"
        ? "npm"
        : input.packageManager;
    yield* printHuman(`Running ${input.name} hook`);
    yield* runStep(
      {
        command: runner,
        args: ["run", input.name],
        cwd: input.projectRoot,
        env: input.env,
      },
      input.name,
    );
  });
