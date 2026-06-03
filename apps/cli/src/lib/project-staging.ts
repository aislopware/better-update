import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import ignore from "ignore";

import type { Ignore } from "ignore";

import { runStep } from "../commands/build/run-step";
import { CliRuntime } from "../services/cli-runtime";
import { StagingError } from "./exit-codes";
import { formatCause } from "./format-error";
import { printHuman } from "./output";

import type { ProjectType } from "./detect-project-type";
import type { BuildFailedError } from "./exit-codes";
import type { OutputMode } from "./output-mode";

const execFileAsync = promisify(execFile);

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export interface StagingProject {
  /** Workspace-root mirror inside the temp dir — where `<pm> install` runs. */
  readonly stagingRoot: string;
  /** Mirror of the user's cwd inside the staging tree — where prebuild / xcodebuild / gradlew run. */
  readonly projectRoot: string;
  readonly packageManager: PackageManager;
  /** Empty when single-app; `apps/<name>` for monorepo sub-apps. */
  readonly relAppPath: string;
}

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * Generated native build outputs / dependency dirs that must never be copied —
 * they are regenerated in staging (Pods via `pod install`, build/ via gradle).
 */
const NATIVE_BUILD_OUTPUTS = [
  "ios/build",
  "ios/Pods",
  "ios/DerivedData",
  "android/build",
  "android/app/build",
  "android/.gradle",
  "android/.kotlin",
] as const;

/** Non-native dirs never copied into staging (reinstalled / regenerated fresh). */
const GENERAL_IGNORE = ["node_modules", ".git", ".expo", ".gradle", ".turbo", "dist"] as const;

/**
 * Paths never copied into staging — covers generated native build outputs and
 * dependency dirs that must be reinstalled fresh in staging.
 */
const ALWAYS_IGNORE = [...GENERAL_IGNORE, ...NATIVE_BUILD_OUTPUTS] as const;

const findLockfile = (
  fs: FileSystem.FileSystem,
  dir: string,
): Effect.Effect<PackageManager | undefined> =>
  Effect.gen(function* () {
    for (const [name, pm] of LOCKFILES) {
      const exists = yield* fs.exists(path.join(dir, name)).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return pm;
      }
    }
    return undefined;
  });

interface WorkspaceLookup {
  readonly workspaceRoot: string;
  readonly packageManager: PackageManager;
}

const walkUpForLockfile = (
  startCwd: string,
  dir: string,
): Effect.Effect<WorkspaceLookup, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pm = yield* findLockfile(fs, dir);
    if (pm !== undefined) {
      return { workspaceRoot: dir, packageManager: pm };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return { workspaceRoot: startCwd, packageManager: "bun" as const };
    }
    return yield* walkUpForLockfile(startCwd, parent);
  });

/**
 * Walk up from `cwd` to the first ancestor directory containing a lockfile.
 * That directory is the install root (monorepo workspace root or the app dir
 * itself in single-app layouts). Defaults to `cwd` + bun when no lockfile is
 * found anywhere up to the volume root.
 */
export const detectWorkspaceRoot = (
  cwd: string,
): Effect.Effect<WorkspaceLookup, never, FileSystem.FileSystem> => walkUpForLockfile(cwd, cwd);

export interface BuildIgnoreOptions {
  /**
   * Force-include the native source dirs (`android/`, `ios/`) even when the
   * project's `.gitignore` excludes them. Bare/KMP/native projects ship these
   * dirs as source (no `expo prebuild` regenerates them), so they must reach
   * staging; only their build outputs stay excluded. `appRelPath` scopes the
   * re-include to the app dir inside a monorepo (empty for single-app layouts).
   */
  readonly includeNativeSource?: boolean;
  readonly appRelPath?: string;
}

/**
 * Build an `Ignore` matcher for the workspace root. `.easignore` REPLACES
 * `.gitignore` when present (matches EAS semantics); otherwise `.gitignore`
 * is layered on top of the always-ignore baseline.
 *
 * When `includeNativeSource` is set, the native source dirs are re-included
 * after the ignore files are applied, then their build outputs re-excluded, so
 * a committed `ios/`/`android/` reaches staging intact.
 */
export const buildIgnoreInstance = (
  workspaceRoot: string,
  options: BuildIgnoreOptions = {},
): Effect.Effect<Ignore, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ig = ignore();
    ig.add([...ALWAYS_IGNORE]);

    const easignorePath = path.join(workspaceRoot, ".easignore");
    const hasEasignore = yield* fs.exists(easignorePath).pipe(Effect.orElseSucceed(() => false));
    if (hasEasignore) {
      const content = yield* fs.readFileString(easignorePath).pipe(Effect.orElseSucceed(() => ""));
      ig.add(content);
    } else {
      const gitignorePath = path.join(workspaceRoot, ".gitignore");
      const hasGitignore = yield* fs.exists(gitignorePath).pipe(Effect.orElseSucceed(() => false));
      if (hasGitignore) {
        const content = yield* fs
          .readFileString(gitignorePath)
          .pipe(Effect.orElseSucceed(() => ""));
        ig.add(content);
      }
    }

    if (options.includeNativeSource === true) {
      const base =
        options.appRelPath === undefined || options.appRelPath === ""
          ? ""
          : `${options.appRelPath}/`;
      // Re-include the native source dirs (last-match-wins overrides any
      // .gitignore exclusion), then re-exclude their generated build outputs.
      ig.add([`!${base}android`, `!${base}ios`]);
      ig.add(NATIVE_BUILD_OUTPUTS.map((entry) => `${base}${entry}`));
    }
    return ig;
  });

const copyProjectTree = (params: {
  readonly source: string;
  readonly dest: string;
  readonly ig: Ignore;
}): Effect.Effect<void, StagingError> =>
  Effect.tryPromise({
    try: async () => {
      await fsp.cp(params.source, params.dest, {
        recursive: true,
        dereference: false,
        filter: (src) => {
          const rel = path.relative(params.source, src);
          if (rel === "") {
            return true;
          }
          const posixRel = rel.split(path.sep).join("/");
          return !params.ig.ignores(posixRel);
        },
      });
    },
    catch: (cause) =>
      new StagingError({
        message: `Failed to copy project to staging dir: ${formatCause(cause)}`,
      }),
  });

/**
 * EAS stages projects via `git clone`, so `.git` is always present and prepare
 * scripts that shell out to git (lefthook install, husky install,
 * simple-git-hooks, etc.) succeed naturally. Our copy strips `.git` for size,
 * so we recreate a bare repo at the staging root before install runs. The
 * hooks installed here never fire because no one commits in the staging dir —
 * they exist only so `git rev-parse` succeeds during postinstall.
 */
const initGitRepo = (stagingRoot: string): Effect.Effect<void, StagingError> =>
  Effect.tryPromise({
    try: async () => execFileAsync("git", ["init", "-q", stagingRoot]),
    catch: (cause) =>
      new StagingError({
        message: `Failed to init git repo in staging dir: ${formatCause(cause)}`,
      }),
  }).pipe(Effect.asVoid);

const runInstall = (params: {
  readonly stagingRoot: string;
  readonly packageManager: PackageManager;
  readonly env: Readonly<Record<string, string>>;
}): Effect.Effect<void, BuildFailedError, OutputMode> =>
  runStep(
    {
      command: params.packageManager,
      args: ["install"],
      cwd: params.stagingRoot,
      env: params.env,
    },
    `${params.packageManager} install`,
  );

export interface PrepareStagingProjectInput {
  readonly userCwd: string;
  readonly tempDir: string;
  readonly envVars: Readonly<Record<string, string>>;
  /**
   * Build-system family. Non-Expo projects keep their committed `android/`/`ios/`
   * source (force-included into staging) and skip `<pm> install` when there is no
   * JS package manifest (pure-native / KMP). Defaults to Expo behavior.
   */
  readonly projectType?: ProjectType;
}

/**
 * Copy the user's project (or workspace root, for monorepos) into a fresh
 * directory inside `tempDir`, then run `<pm> install` there. The build then
 * runs entirely against the staged copy — the user's working tree stays clean
 * regardless of what `expo prebuild`, `pod install`, or `gradlew` write.
 */
export const prepareStagingProject = (
  input: PrepareStagingProjectInput,
): Effect.Effect<
  StagingProject,
  StagingError | BuildFailedError,
  FileSystem.FileSystem | CliRuntime | OutputMode
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const { workspaceRoot, packageManager } = yield* detectWorkspaceRoot(input.userCwd);
    const relAppPath = path.relative(workspaceRoot, input.userCwd);
    const stagingRoot = path.join(input.tempDir, "project");
    const projectRoot = relAppPath === "" ? stagingRoot : path.join(stagingRoot, relAppPath);

    yield* printHuman(
      `Staging build into ${stagingRoot}${relAppPath === "" ? "" : ` (app: ${relAppPath})`}`,
    );

    const includeNativeSource = input.projectType !== undefined && input.projectType !== "expo";
    const ig = yield* buildIgnoreInstance(workspaceRoot, {
      includeNativeSource,
      appRelPath: relAppPath,
    });
    yield* copyProjectTree({ source: workspaceRoot, dest: stagingRoot, ig });
    yield* initGitRepo(stagingRoot);

    // Skip `<pm> install` for projects with no JS manifest (pure-native / KMP) —
    // there is nothing to install and the package manager would error.
    const hasPackageJson = yield* fs
      .exists(path.join(workspaceRoot, "package.json"))
      .pipe(Effect.orElseSucceed(() => false));
    if (hasPackageJson) {
      const commandEnv = yield* runtime.commandEnvironment(input.envVars);
      yield* runInstall({ stagingRoot, packageManager, env: commandEnv });
    } else {
      yield* printHuman("No package.json at the staging root — skipping dependency install.");
    }

    return { stagingRoot, projectRoot, packageManager, relAppPath };
  });
