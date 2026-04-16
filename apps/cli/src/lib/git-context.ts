import { Command, CommandExecutor } from "@effect/platform";
import { Effect } from "effect";

export interface GitContext {
  readonly ref: string | undefined;
  readonly commit: string | undefined;
  readonly commitMessage: string | undefined;
  readonly dirty: boolean;
}

const runString = (
  cmd: Command.Command,
  cwd: string,
): Effect.Effect<string, unknown, CommandExecutor.CommandExecutor> =>
  Command.string(Command.workingDirectory(cmd, cwd));

/**
 * Best-effort git context extraction. If git is missing, the directory isn't
 * a repo, or any command fails, we silently return undefined fields so the
 * build can still proceed. This is intentional — git context is metadata,
 * not a requirement.
 */
export const readGitContext = (
  projectRoot: string,
): Effect.Effect<GitContext, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const [commit, ref, commitMessage, status] = yield* Effect.all(
      [
        runString(Command.make("git", "rev-parse", "HEAD"), projectRoot).pipe(
          Effect.map((s) => s.trim()),
          Effect.catchAll(() => Effect.succeed("")),
        ),
        runString(Command.make("git", "symbolic-ref", "--short", "HEAD"), projectRoot).pipe(
          Effect.map((s) => s.trim()),
          Effect.catchAll(() => Effect.succeed("")),
        ),
        runString(Command.make("git", "log", "-1", "--format=%s"), projectRoot).pipe(
          Effect.map((s) => s.trim()),
          Effect.catchAll(() => Effect.succeed("")),
        ),
        runString(Command.make("git", "status", "--porcelain"), projectRoot).pipe(
          Effect.catchAll(() => Effect.succeed("")),
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
