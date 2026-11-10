import { execFile, spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { Effect } from "effect";

import { StagingError } from "./exit-codes";
import { formatCause } from "./format-error";

const execFileAsync = promisify(execFile);

/**
 * EAS stages projects via `git clone`, so `.git` is always present and prepare
 * scripts that shell out to git (lefthook install, husky install,
 * simple-git-hooks, etc.) succeed naturally. Our copy strips `.git` for size,
 * so we recreate a bare repo at the staging root before install runs. The
 * hooks installed here never fire because no one commits in the staging dir —
 * they exist only so `git rev-parse` succeeds during postinstall.
 */
export const initGitRepo = (stagingRoot: string): Effect.Effect<void, StagingError> =>
  Effect.tryPromise({
    try: async () => execFileAsync("git", ["init", "-q", stagingRoot]),
    catch: (cause) =>
      new StagingError({
        message: `Failed to init git repo in staging dir: ${formatCause(cause)}`,
      }),
  }).pipe(Effect.asVoid);

const SNAPSHOT_IDENTITY = "better-update <build@better-update.invalid>";
const SNAPSHOT_MESSAGE = "better-update staging snapshot";

const escapePathChar = (char: string): string => {
  const code = char.codePointAt(0) ?? 0;
  if (char === "\\" || char === '"') {
    return `\\${char}`;
  }
  return code < 0x20 || code === 0x7f ? `\\${code.toString(8).padStart(3, "0")}` : char;
};

/**
 * Quote a path for a fast-import `M` line: C-style, always quoted so a name
 * that starts with `"` or holds a newline is unambiguous. Non-ASCII stays as
 * raw UTF-8, which git accepts inside quotes.
 */
export const quoteFastImportPath = (rel: string): string =>
  `"${Array.from(rel, escapePathChar).join("")}"`;

/** Files read at once while streaming the snapshot into `git fast-import`. */
const SNAPSHOT_READ_BATCH = 64;

/**
 * Start `git fast-import` writing one uncompressed pack, undeltified (deltas
 * cost CPU for a pack that is thrown away with the temp dir). `write` honors
 * stdin backpressure; `finish` closes the stream and resolves whether the
 * import succeeded.
 */
const spawnFastImport = (cwd: string) => {
  const child = spawn(
    "git",
    [
      "-c",
      "core.compression=0",
      "-c",
      "pack.compression=0",
      "fast-import",
      "--quiet",
      "--depth=0",
      "--done",
    ],
    { cwd, stdio: ["pipe", "ignore", "ignore"] },
  );
  const succeeded = new Promise<boolean>((resolve) => {
    child.on("error", () => {
      resolve(false);
    });
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
  // Swallow EPIPE: a fast-import that dies early surfaces through `succeeded`.
  child.stdin.on("error", () => undefined);
  const write = async (chunk: string | Uint8Array): Promise<void> => {
    if (child.stdin.write(chunk)) {
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        child.stdin.off("drain", done);
        child.off("close", done);
        resolve();
      };
      child.stdin.on("drain", done);
      child.on("close", done);
    });
  };
  const finish = async (): Promise<boolean> => {
    await write("\ndone\n");
    child.stdin.end();
    return succeeded;
  };
  return { write, finish };
};

/** One staged file as git stores it: its mode and its bytes (a link's target). */
const readSnapshotEntry = async (stagingRoot: string, rel: string) => {
  const abs = path.join(stagingRoot, rel);
  const stat = await fsp.lstat(abs);
  if (stat.isSymbolicLink()) {
    return { rel, mode: "120000", data: Buffer.from(await fsp.readlink(abs)) };
  }
  // eslint-disable-next-line eslint-js/no-bitwise -- the owner-execute bit decides git's 100755 vs 100644
  const mode = (stat.mode & 0o100) === 0 ? "100644" : "100755";
  return { rel, mode, data: await fsp.readFile(abs) };
};

/**
 * Commit every non-ignored file in `stagingRoot` through `git fast-import`.
 *
 * `git add -A` writes one zlib-compressed loose object per file: about 15s for
 * a 31k-file monorepo on a fast Mac and roughly three times that on a CI
 * runner. fast-import streams the same blobs into ONE uncompressed pack (about
 * 2s), and `read-tree` + `update-index --refresh` then rebuild the index from
 * the commit so `git status` sees the files as tracked and unchanged. The pack
 * lives in the temp dir and is deleted with it, so skipping compression costs
 * only transient disk. Resolves `false` when fast-import fails.
 */
const fastImportSnapshot = async (
  stagingRoot: string,
  git: (args: readonly string[]) => Promise<string>,
): Promise<boolean> => {
  const listed = await git(["ls-files", "-z", "--others", "--exclude-standard"]);
  // A trailing slash marks a nested repository, which `git add` would record as
  // a gitlink rather than content; staging strips every `.git`, so none appear
  // in practice.
  const files = listed.split("\0").filter((rel) => rel !== "" && !rel.endsWith("/"));
  const headRef = await git(["symbolic-ref", "HEAD"]);
  const importer = spawnFastImport(stagingRoot);
  const now = Math.floor(Date.now() / 1000);
  await importer.write(`commit ${headRef.trim()}\ncommitter ${SNAPSHOT_IDENTITY} ${now} +0000\n`);
  await importer.write(`data ${Buffer.byteLength(SNAPSHOT_MESSAGE)}\n${SNAPSHOT_MESSAGE}\n`);
  for (let index = 0; index < files.length; index += SNAPSHOT_READ_BATCH) {
    const batch = await Promise.all(
      files
        .slice(index, index + SNAPSHOT_READ_BATCH)
        .map(async (rel) => readSnapshotEntry(stagingRoot, rel)),
    );
    for (const { rel, mode, data } of batch) {
      await importer.write(`M ${mode} inline ${quoteFastImportPath(rel)}\ndata ${data.length}\n`);
      await importer.write(data);
      await importer.write("\n");
    }
  }
  if (!(await importer.finish())) {
    return false;
  }
  await git(["read-tree", "HEAD"]);
  // Exits 1 while files still differ from the index; the caller checks status.
  await git(["update-index", "-q", "--refresh"]).catch(() => "");
  return true;
};

/**
 * Snapshot the staged tree as a single commit so its working tree reads CLEAN.
 *
 * EAS stages via `git clone` + checkout, so the tree it hands to
 * `expo prebuild --clean` is a clean checkout. Our copy + `git init` leaves
 * every staged file UNTRACKED, which `expo prebuild`'s git check reads as
 * "dirty" (`git status --porcelain` is non-empty). Because the native build
 * runs inside a PTY, Expo's `isInteractive()` is true even with no real
 * controlling TTY, so it prompts `Continue with uncommitted changes?` and then
 * blocks on stdin we never write — hanging CI / backgrounded / piped builds.
 *
 * Committing once here makes `git status` clean, so Expo's check passes on
 * EVERY Expo version — the `EXPO_NO_GIT_STATUS` env gate the build sets did not
 * stop SDK 56 prompting — with no global `CI=1` side effects. The real
 * dirty-tree decision already ran against the user's *actual* working tree in
 * `ensureRepoClean` (honoring `--allow-dirty`).
 *
 * The bulk of the tree goes in through {@link fastImportSnapshot}. fast-import
 * stores bytes as they are, so a file that git's clean filters would rewrite
 * (LFS, `text=auto` line endings) still reads modified afterwards; a
 * `git add -A` + commit of whatever is left catches those, and stands in for
 * the whole snapshot if fast-import fails. Best-effort: hooks are disabled and
 * a failure is non-fatal — the build proceeds and `EXPO_NO_GIT_STATUS` still
 * covers newer Expo.
 */
export const commitStagingSnapshot = (stagingRoot: string): Effect.Effect<void> => {
  const git = async (args: readonly string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd: stagingRoot,
      maxBuffer: 1024 * 1024 * 1024,
      // Don't fire the user's git hooks (lefthook / husky / simple-git-hooks,
      // installed by the staged postinstall) on this throwaway snapshot.
      env: { ...process.env, LEFTHOOK: "0", HUSKY: "0" },
    });
    return stdout;
  };
  return Effect.tryPromise(async () => {
    const imported = await fastImportSnapshot(stagingRoot, git).catch(() => false);
    const status = imported ? await git(["status", "--porcelain"]) : "dirty";
    if (status.trim() === "") {
      return;
    }
    await git(["add", "-A"]);
    await git([
      "-c",
      "user.name=better-update",
      "-c",
      "user.email=build@better-update.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "--allow-empty",
      "-q",
      "-m",
      SNAPSHOT_MESSAGE,
    ]);
  }).pipe(Effect.ignore);
};
