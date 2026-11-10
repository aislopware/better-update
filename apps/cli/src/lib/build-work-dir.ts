import { promises as fsp } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import type { FileSystem, PlatformError, Scope } from "effect";

import { StagingError } from "./exit-codes";
import { formatCause } from "./format-error";
import { acquireBuildTempDir } from "./temp-dir";

/**
 * Build in `<dir>/better-update-<platform>` instead of a random temp dir. Every path a
 * compile sees (staged project, DerivedData, Pods) then repeats run to run, so
 * ccache keyed on command lines can hit. Unset: a fresh random temp dir.
 */
export const BUILD_DIR_ENV = "BETTER_UPDATE_BUILD_DIR";

const LOCK_SUFFIX = ".lock";
const PID_FILE = "pid";

const errnoCode = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return errnoCode(error) === "EPERM";
  }
};

/** A lock this young with no pid yet is mid-creation by its owner, not stale. */
const FRESH_LOCK_MS = 30_000;

/** The pid holding `lockDir`, `"starting"` while its owner writes it, else undefined. */
const readLockHolder = async (lockDir: string): Promise<number | "starting" | undefined> => {
  const raw = await fsp.readFile(path.join(lockDir, PID_FILE), "utf8").catch(() => undefined);
  const pid = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isInteger(pid) && pid > 0) {
    return isAlive(pid) ? pid : undefined;
  }
  const stat = await fsp.stat(lockDir).catch(() => undefined);
  return stat !== undefined && Date.now() - stat.mtimeMs < FRESH_LOCK_MS ? "starting" : undefined;
};

type LockOutcome =
  | { readonly taken: true }
  | { readonly taken: false; readonly holder: number | "starting" | undefined };

/**
 * Take `<dir>.lock` (an atomic `mkdir`) so two builds never share one dir. A
 * lock whose pid is gone is stale (a crashed or killed run) and is taken over.
 */
const takeLock = async (lockDir: string): Promise<LockOutcome> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (
      await fsp.mkdir(lockDir).then(
        () => true,
        () => false,
      )
    ) {
      await fsp.writeFile(path.join(lockDir, PID_FILE), String(process.pid));
      return { taken: true };
    }
    const holder = await readLockHolder(lockDir);
    if (holder !== undefined) {
      return { taken: false, holder };
    }
    await fsp.rm(lockDir, { recursive: true, force: true });
  }
  return { taken: false, holder: undefined };
};

const holderLabel = (holder: number | "starting" | undefined) =>
  typeof holder === "number" ? ` (pid ${String(holder)})` : "";

const wipe = async (dir: string) => fsp.rm(dir, { recursive: true, force: true });

/**
 * Lock, empty and `chmod 0o700` the stable build dir; on scope close remove it
 * and its lock. It holds the same secrets a temp dir does (keychain, decrypted
 * credentials), so nothing outlives the build: only the PATH is reused.
 */
const acquireStableBuildDir = (dir: string): Effect.Effect<string, StagingError, Scope.Scope> => {
  const lockDir = `${dir}${LOCK_SUFFIX}`;
  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        await fsp.mkdir(path.dirname(dir), { recursive: true });
        const lock = await takeLock(lockDir);
        if (!lock.taken) {
          return lock;
        }
        await wipe(dir);
        await fsp.mkdir(dir, { mode: 0o700 });
        await fsp.chmod(dir, 0o700);
        return lock;
      },
      catch: (cause) =>
        new StagingError({ message: `Could not prepare build dir ${dir}: ${formatCause(cause)}` }),
    }).pipe(
      Effect.flatMap((lock) =>
        lock.taken
          ? Effect.succeed(dir)
          : Effect.fail(
              new StagingError({
                message: `Build dir ${dir} is in use by another better-update build${holderLabel(lock.holder)}. Give each concurrent build its own ${BUILD_DIR_ENV}, or remove ${lockDir} if no build is running.`,
              }),
            ),
      ),
    ),
    () =>
      Effect.promise(async () => {
        await wipe(dir);
        await wipe(lockDir);
      }),
  );
};

const isWithin = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * The directory one platform build stages and compiles in:
 * `<BUILD_DIR>/better-update-<platform>` when {@link BUILD_DIR_ENV} is set
 * (relative paths resolve against `cwd`), else a random scoped temp dir. The
 * per-platform segment keeps `--platform all`'s concurrent iOS and Android
 * builds apart. The dir is wiped before and after the build, so one inside or
 * around the project is refused rather than deleting the user's own files.
 */
export const acquireBuildWorkDir = (params: {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}): Effect.Effect<
  string,
  StagingError | PlatformError.PlatformError,
  FileSystem.FileSystem | Scope.Scope
> => {
  const root = params.env[BUILD_DIR_ENV]?.trim();
  if (root === undefined || root === "") {
    return acquireBuildTempDir;
  }
  const dir = path.resolve(params.cwd, root, `better-update-${params.platform}`);
  const project = path.resolve(params.cwd);
  return isWithin(project, dir) || isWithin(dir, project)
    ? Effect.fail(
        new StagingError({
          message: `${BUILD_DIR_ENV} must point outside the project: ${dir} overlaps ${project}, and the build dir is wiped before and after every build.`,
        }),
      )
    : acquireStableBuildDir(dir);
};
