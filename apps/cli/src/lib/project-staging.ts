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
import { runBuildHook } from "./build-hooks";
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
  /** False when no lockfile was found anywhere up to the volume root. */
  readonly lockfileFound: boolean;
}

const walkUpForLockfile = (
  startCwd: string,
  dir: string,
): Effect.Effect<WorkspaceLookup, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pm = yield* findLockfile(fs, dir);
    if (pm !== undefined) {
      return { workspaceRoot: dir, packageManager: pm, lockfileFound: true };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return { workspaceRoot: startCwd, packageManager: "bun" as const, lockfileFound: false };
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
 * Rebase a single nested `.gitignore` line so it applies only within `prefix`
 * (the posix dir path + trailing slash) when folded into the workspace-root
 * matcher. Returns `undefined` for blanks/comments. Anchored patterns (a
 * leading or interior `/`) are prefixed as-is; unanchored ones (which match at
 * any depth) become `prefix**\/pat`. Negation and directory-only trailing
 * slashes are preserved.
 */
const rebaseGitignoreLine = (prefix: string, rawLine: string): string | undefined => {
  // git strips trailing whitespace unless it is backslash-escaped.
  const line = rawLine.replace(/(?<!\\)\s+$/u, "");
  if (line === "" || line.startsWith("#")) {
    return undefined;
  }
  const negate = line.startsWith("!");
  const unescaped =
    negate || line.startsWith(String.raw`\#`) || line.startsWith(String.raw`\!`)
      ? line.slice(1)
      : line;
  const hadLeadingSlash = unescaped.startsWith("/");
  const body = hadLeadingSlash ? unescaped.slice(1) : unescaped;
  if (body === "") {
    return undefined;
  }
  // A separator anywhere but the trailing position anchors the pattern to the
  // `.gitignore`'s own dir; otherwise it matches at any depth below it.
  const withoutTrailingSlash = body.endsWith("/") ? body.slice(0, -1) : body;
  const anchored = hadLeadingSlash || withoutTrailingSlash.includes("/");
  const rebased = anchored ? `${prefix}${body}` : `${prefix}**/${body}`;
  return negate ? `!${rebased}` : rebased;
};

/**
 * Rebase every line of a nested `.gitignore` to its own directory (`relDir`,
 * posix, relative to the workspace root) — mirroring how git scopes a
 * `.gitignore` to the dir it lives in.
 */
const rebaseGitignore = (relDir: string, content: string): string[] => {
  const prefix = `${relDir}/`;
  return content
    .split(/\r?\n/u)
    .map((rawLine) => rebaseGitignoreLine(prefix, rawLine))
    .filter((pattern): pattern is string => pattern !== undefined);
};

const safeReadDir = async (dir: string) => {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const safeReadText = async (file: string): Promise<string> => {
  try {
    return await fsp.readFile(file, "utf8");
  } catch {
    return "";
  }
};

const isDirectory = async (file: string): Promise<boolean> => {
  try {
    const stat = await fsp.lstat(file);
    return stat.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Fold every NESTED `.gitignore` under `workspaceRoot` into `ig`, each rebased
 * to its own directory (git scopes a `.gitignore` to the dir it lives in, and
 * EAS — which stages via git — honors that). The walk prunes any directory the
 * matcher-so-far already ignores, so it never descends into `node_modules`,
 * build outputs, or a subtree excluded by a shallower `.gitignore` — including
 * the entries a just-loaded nested `.gitignore` adds. The root `.gitignore` is
 * added by the caller, so the walk skips it.
 */
const addNestedGitignores = (workspaceRoot: string, ig: Ignore): Effect.Effect<void> =>
  Effect.promise(async () => {
    const walk = async (absDir: string, relDir: string): Promise<void> => {
      const entries = await safeReadDir(absDir);
      if (relDir !== "" && entries.some((entry) => entry.isFile() && entry.name === ".gitignore")) {
        const content = await safeReadText(path.join(absDir, ".gitignore"));
        if (content !== "") {
          ig.add(rebaseGitignore(relDir, content));
        }
      }
      const subdirs = entries.filter((entry) => entry.isDirectory());
      for (const entry of subdirs) {
        const childRel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
        // `foo/` rules only match with a trailing slash, so test both forms;
        // pruning here keeps the walk out of huge ignored trees entirely.
        if (!ig.ignores(childRel) && !ig.ignores(`${childRel}/`)) {
          await walk(path.join(absDir, entry.name), childRel);
        }
      }
    };
    await walk(workspaceRoot, "");
  });

/**
 * Build an `Ignore` matcher for the workspace root. `.easignore` REPLACES every
 * `.gitignore` when present (matches EAS semantics); otherwise the root
 * `.gitignore` plus every NESTED `.gitignore` (git semantics) is layered on top
 * of the always-ignore baseline.
 *
 * When `includeNativeSource` is set, the native source dirs are re-included
 * before the nested scan (so the scan descends into committed `android/`/`ios/`
 * and folds in their nested ignores), then their build outputs re-excluded last,
 * so a committed `ios/`/`android/` reaches staging intact.
 */
export const buildIgnoreInstance = (
  workspaceRoot: string,
  options: BuildIgnoreOptions = {},
): Effect.Effect<Ignore, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ig = ignore();
    ig.add([...ALWAYS_IGNORE]);

    const base =
      options.appRelPath === undefined || options.appRelPath === "" ? "" : `${options.appRelPath}/`;

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

    // Re-include committed native source BEFORE the nested scan, so the walk
    // descends into `android/`/`ios/` and folds in any nested `.gitignore`.
    if (options.includeNativeSource === true) {
      ig.add([`!${base}android`, `!${base}ios`]);
    }

    // Honor NESTED `.gitignore` files (git / EAS semantics). `.easignore`, when
    // present, REPLACES all `.gitignore` files, so it is skipped in that mode.
    if (!hasEasignore) {
      yield* addNestedGitignores(workspaceRoot, ig);
    }

    // Re-exclude generated native build outputs last, so neither the native
    // re-include above nor any nested `.gitignore` can pull them into staging.
    if (options.includeNativeSource === true) {
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
        filter: async (src) => {
          const rel = path.relative(params.source, src);
          if (rel === "") {
            return true;
          }
          const posixRel = rel.split(path.sep).join("/");
          // Append a trailing slash for directories so directory-only rules
          // (`foo/`) prune the whole subtree here instead of crawling into it
          // (returning `false` for a dir tells `cp` to skip its descendants).
          const isDir = await isDirectory(src);
          return !params.ig.ignores(isDir ? `${posixRel}/` : posixRel);
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

/**
 * Snapshot the staged tree as a single commit so its working tree reads CLEAN.
 *
 * EAS stages via `git clone` + checkout, so the tree it hands to
 * `expo prebuild --clean` is a clean checkout. Our `cp` + `git init` leaves
 * every staged file UNTRACKED, which `expo prebuild`'s git check reads as
 * "dirty" (`git status --porcelain` is non-empty). Because the native build
 * runs inside a PTY, Expo's `isInteractive()` is true even with no real
 * controlling TTY, so it prompts `Continue with uncommitted changes?` and then
 * blocks on stdin we never write — hanging CI / backgrounded / piped builds.
 *
 * Committing once here makes `git status` clean, so Expo's check passes on
 * EVERY Expo version — the `EXPO_NO_GIT_STATUS` env gate the build sets only
 * exists in newer Expo — with no global `CI=1` side effects. The real
 * dirty-tree decision already ran against the user's *actual* working tree in
 * `ensureRepoClean` (honoring `--allow-dirty`). Best-effort: hooks are disabled
 * and a failure is non-fatal — the build proceeds and `EXPO_NO_GIT_STATUS`
 * still covers newer Expo.
 */
export const commitStagingSnapshot = (stagingRoot: string): Effect.Effect<void> =>
  Effect.tryPromise(async () => {
    const run = async (args: readonly string[]): Promise<unknown> =>
      execFileAsync("git", [...args], {
        cwd: stagingRoot,
        // Don't fire the user's git hooks (lefthook / husky / simple-git-hooks,
        // installed by the staged postinstall) on this throwaway snapshot.
        env: { ...process.env, LEFTHOOK: "0", HUSKY: "0" },
      });
    await run(["add", "-A"]);
    await run([
      "-c",
      "user.name=better-update",
      "-c",
      "user.email=build@better-update.dev",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "--allow-empty",
      "-q",
      "-m",
      "better-update staging snapshot",
    ]);
  }).pipe(Effect.ignore);

/**
 * Install args per package manager, frozen-lockfile variants matching EAS
 * (`bun install --frozen-lockfile` / `npm ci --include=dev` / etc.) so the
 * staged install resolves exactly what the user's lockfile pins.
 */
export const installArgs = (packageManager: PackageManager, frozen: boolean): readonly string[] => {
  if (packageManager === "npm") {
    return frozen ? ["ci", "--include=dev"] : ["install", "--include=dev"];
  }
  return frozen ? ["install", "--frozen-lockfile"] : ["install"];
};

const runInstall = (params: {
  readonly stagingRoot: string;
  readonly packageManager: PackageManager;
  readonly frozen: boolean;
  readonly env: Readonly<Record<string, string>>;
}): Effect.Effect<void, BuildFailedError, OutputMode> =>
  runStep(
    {
      command: params.packageManager,
      args: [...installArgs(params.packageManager, params.frozen)],
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
    const { workspaceRoot, packageManager, lockfileFound } = yield* detectWorkspaceRoot(
      input.userCwd,
    );
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
      const commandEnv = yield* runtime.commandEnvironment({
        ...input.envVars,
        BETTER_UPDATE_BUILD_WORKINGDIR: stagingRoot,
      });
      yield* runBuildHook({
        name: "eas-build-pre-install",
        projectRoot,
        packageManager,
        env: commandEnv,
      });
      // Frozen install (EAS parity) keeps staging on the exact lockfile pins;
      // BETTER_UPDATE_NO_FROZEN_LOCKFILE=1 opts out (mirrors EAS_NO_FROZEN_LOCKFILE).
      const frozen = lockfileFound && commandEnv["BETTER_UPDATE_NO_FROZEN_LOCKFILE"] !== "1";
      yield* runInstall({ stagingRoot, packageManager, frozen, env: commandEnv });
    } else {
      yield* printHuman("No package.json at the staging root — skipping dependency install.");
    }

    // Commit AFTER install so the (potentially lockfile-touching) install is
    // captured and the tree Expo prebuilds against reads clean. See
    // `commitStagingSnapshot` for why this stops `expo prebuild` from hanging.
    yield* commitStagingSnapshot(stagingRoot);

    return { stagingRoot, projectRoot, packageManager, relAppPath };
  });
