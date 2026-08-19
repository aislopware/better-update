import { Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

import type { ChildProcessSpawner } from "effect/unstable/process";

import { runText } from "./child-process";

export interface GitContext {
  readonly ref: string | undefined;
  readonly commit: string | undefined;
  readonly commitMessage: string | undefined;
  readonly dirty: boolean;
}

const runString = (
  cmd: ChildProcess.Command,
  cwd: string,
): Effect.Effect<string, unknown, ChildProcessSpawner.ChildProcessSpawner> =>
  runText(ChildProcess.setCwd(cmd, cwd));

/**
 * Best-effort git context extraction. If git is missing, the directory isn't
 * a repo, or any command fails, we silently return undefined fields so the
 * build can still proceed. This is intentional — git context is metadata,
 * not a requirement.
 */
export const readGitContext = (
  projectRoot: string,
): Effect.Effect<GitContext, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const [commit, ref, commitMessage, status] = yield* Effect.all(
      [
        runString(ChildProcess.make("git", ["rev-parse", "HEAD"]), projectRoot).pipe(
          Effect.map((output) => output.trim()),
          Effect.orElseSucceed(() => ""),
        ),
        runString(ChildProcess.make("git", ["symbolic-ref", "--short", "HEAD"]), projectRoot).pipe(
          Effect.map((output) => output.trim()),
          Effect.orElseSucceed(() => ""),
        ),
        runString(ChildProcess.make("git", ["log", "-1", "--format=%s"]), projectRoot).pipe(
          Effect.map((output) => output.trim()),
          Effect.orElseSucceed(() => ""),
        ),
        runString(ChildProcess.make("git", ["status", "--porcelain"]), projectRoot).pipe(
          Effect.orElseSucceed(() => ""),
        ),
      ],
      { concurrency: "unbounded" },
    );

    return {
      ref: ref.length > 0 ? ref : undefined,
      commit: commit.length > 0 ? commit : undefined,
      commitMessage: commitMessage.length > 0 ? commitMessage : undefined,
      dirty: status.trim().length > 0,
    };
  });
