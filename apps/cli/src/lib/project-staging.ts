import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";
import ignore from "ignore";

import type { Ignore } from "ignore";

import { runStep } from "../commands/build/run-step";
import { CliRuntime } from "../services/cli-runtime";
import { StagingError } from "./exit-codes";
import { formatCause } from "./format-error";

import type { BuildFailedError } from "./exit-codes";

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
 * Paths never copied into staging — covers generated native build outputs and
 * dependency dirs that must be reinstalled fresh in staging.
 */
const ALWAYS_IGNORE = [
  "node_modules",
  ".git",
  "ios/build",
  "ios/Pods",
  "ios/DerivedData",
  "android/build",
  "android/app/build",
  "android/.gradle",
  "android/.kotlin",
  ".expo",
  ".gradle",
  ".turbo",
  "dist",
] as const;

const findLockfile = (
  fs: FileSystem.FileSystem,
  dir: string,
): Effect.Effect<PackageManager | undefined> =>
  Effect.gen(function* () {
    for (const [name, pm] of LOCKFILES) {
      const exists = yield* fs
        .exists(path.join(dir, name))
        .pipe(Effect.catchAll(() => Effect.succeed(false)));
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

/**
 * Build an `Ignore` matcher for the workspace root. `.easignore` REPLACES
 * `.gitignore` when present (matches EAS semantics); otherwise `.gitignore`
 * is layered on top of the always-ignore baseline.
 */
export const buildIgnoreInstance = (
  workspaceRoot: string,
): Effect.Effect<Ignore, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ig = ignore();
    ig.add([...ALWAYS_IGNORE]);

    const easignorePath = path.join(workspaceRoot, ".easignore");
    const hasEasignore = yield* fs
      .exists(easignorePath)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (hasEasignore) {
      const content = yield* fs
        .readFileString(easignorePath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));
      ig.add(content);
      return ig;
    }

    const gitignorePath = path.join(workspaceRoot, ".gitignore");
    const hasGitignore = yield* fs
      .exists(gitignorePath)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
    if (hasGitignore) {
      const content = yield* fs
        .readFileString(gitignorePath)
        .pipe(Effect.catchAll(() => Effect.succeed("")));
      ig.add(content);
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
}): Effect.Effect<void, BuildFailedError> =>
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
  FileSystem.FileSystem | CliRuntime
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const { workspaceRoot, packageManager } = yield* detectWorkspaceRoot(input.userCwd);
    const relAppPath = path.relative(workspaceRoot, input.userCwd);
    const stagingRoot = path.join(input.tempDir, "project");
    const projectRoot = relAppPath === "" ? stagingRoot : path.join(stagingRoot, relAppPath);

    yield* Console.log(
      `Staging build into ${stagingRoot}${relAppPath === "" ? "" : ` (app: ${relAppPath})`}`,
    );

    const ig = yield* buildIgnoreInstance(workspaceRoot);
    yield* copyProjectTree({ source: workspaceRoot, dest: stagingRoot, ig });
    yield* initGitRepo(stagingRoot);

    const commandEnv = yield* runtime.commandEnvironment(input.envVars);
    yield* runInstall({ stagingRoot, packageManager, env: commandEnv });

    return { stagingRoot, projectRoot, packageManager, relAppPath };
  });
