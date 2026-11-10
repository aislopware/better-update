import { constants as fsConstants, promises as fsp } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import type { Ignore } from "ignore";

import { StagingError } from "./exit-codes";
import { formatCause } from "./format-error";

interface StagedTree {
  /** Posix paths relative to the source root, parents before children. */
  readonly dirs: readonly string[];
  readonly files: readonly string[];
  readonly symlinks: readonly string[];
}

/**
 * Walk `source` once, pruning every directory `ig` ignores so the walk never
 * descends into `node_modules`, build outputs or an ignored subtree. Directory
 * rules (`foo/`) are tested with a trailing slash. Symlinks are listed, never
 * followed. Sockets, FIFOs and devices are skipped.
 */
const listProjectTree = async (source: string, ig: Ignore): Promise<StagedTree> => {
  const dirs: string[] = [];
  const files: string[] = [];
  const symlinks: string[] = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const subdirs: string[] = [];
    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!ig.ignores(`${rel}/`)) {
          dirs.push(rel);
          subdirs.push(rel);
        }
      } else if ((entry.isFile() || entry.isSymbolicLink()) && !ig.ignores(rel)) {
        (entry.isFile() ? files : symlinks).push(rel);
      }
    }
    for (const rel of subdirs) {
      await walk(path.join(source, rel), rel);
    }
  };
  await walk(source, "");
  return { dirs, files, symlinks };
};

/** Parallel copies: enough to keep an SSD busy without exhausting file handles. */
const COPY_CONCURRENCY = 16;

/**
 * Copy the non-ignored part of `source` into `dest`.
 *
 * Files are copied with `COPYFILE_FICLONE`: a copy-on-write clone where the
 * filesystem supports it (APFS, btrfs, XFS), a plain copy elsewhere. Either
 * way staging never shares data with the user's tree, which a hardlink would.
 * Copies run in parallel; `fs.cp` with a per-entry async filter copied one
 * entry at a time and took about 5x as long on a 31k-file monorepo.
 *
 * Symlinks are recreated as written: otherwise a relative link (a framework's
 * `Versions/Current`) would point back into the source tree.
 */
export const copyProjectTree = (params: {
  readonly source: string;
  readonly dest: string;
  readonly ig: Ignore;
}): Effect.Effect<void, StagingError> =>
  Effect.tryPromise({
    try: async () => {
      const tree = await listProjectTree(params.source, params.ig);
      const to = (rel: string) => path.join(params.dest, rel);
      const from = (rel: string) => path.join(params.source, rel);
      await fsp.mkdir(params.dest, { recursive: true });
      // Parents come before children, so each mkdir finds its parent in place.
      for (const rel of tree.dirs) {
        await fsp.mkdir(to(rel), { recursive: true });
      }
      const queue = [...tree.files];
      const worker = async (): Promise<void> => {
        for (let rel = queue.pop(); rel !== undefined; rel = queue.pop()) {
          await fsp.copyFile(from(rel), to(rel), fsConstants.COPYFILE_FICLONE);
        }
      };
      await Promise.all(Array.from({ length: COPY_CONCURRENCY }, worker));
      for (const rel of tree.symlinks) {
        await fsp.symlink(await fsp.readlink(from(rel)), to(rel));
      }
    },
    catch: (cause) =>
      new StagingError({
        message: `Failed to copy project to staging dir: ${formatCause(cause)}`,
      }),
  });
