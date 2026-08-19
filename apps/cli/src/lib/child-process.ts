import { Effect } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { PlatformError } from "effect/PlatformError";
import type { ChildProcess } from "effect/unstable/process";

/**
 * The two ways this CLI runs an external process.
 *
 * Effect v4 moved the run-and-collect conveniences off the `Command` value and
 * onto the `ChildProcessSpawner` service, so every call site would otherwise
 * have to pull the service out of context first. These two wrappers keep the
 * `.pipe` chains at the call sites intact.
 */

/**
 * Run a command and return everything it wrote to stdout.
 *
 * As in v3, the exit code is NOT checked: callers here read tools that report
 * "nothing found" via a non-zero exit with usable stdout (`git symbolic-ref` on
 * a detached HEAD, `keytool` on a bad password) and decide for themselves what
 * an empty result means.
 */
export const runText = (
  command: ChildProcess.Command,
): Effect.Effect<string, PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
  ChildProcessSpawner.ChildProcessSpawner.pipe(
    Effect.flatMap((spawner) => spawner.string(command)),
  );

/** Run a command to completion and return its exit code. */
export const runExitCode = (
  command: ChildProcess.Command,
): Effect.Effect<
  ChildProcessSpawner.ExitCode,
  PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  ChildProcessSpawner.ChildProcessSpawner.pipe(
    Effect.flatMap((spawner) => spawner.exitCode(command)),
  );
