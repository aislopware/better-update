import process from "node:process";

import { Command, CommandExecutor } from "@effect/platform";
import { Effect, Fiber, Scope, Stream } from "effect";

import { BuildFailedError } from "../../lib/exit-codes";

import type { XcodebuildFormatter } from "../../lib/xcpretty-formatter";

export const runStep = (
  cmd: Command.Command,
  step: string,
): Effect.Effect<void, BuildFailedError, CommandExecutor.CommandExecutor> =>
  Command.exitCode(cmd.pipe(Command.stdout("inherit"), Command.stderr("inherit"))).pipe(
    Effect.mapError(
      (cause) =>
        new BuildFailedError({
          step,
          exitCode: 1,
          message: `${step} failed to spawn: ${String(cause)}`,
        }),
    ),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new BuildFailedError({
              step,
              exitCode: code,
              message: `${step} exited with code ${code}`,
            }),
          ),
    ),
  );

/**
 * Run a build step with stdout piped through a formatter (e.g., xcpretty).
 * stderr passes through to the terminal directly.
 */
export const runStepFormatted = (
  cmd: Command.Command,
  step: string,
  formatter: XcodebuildFormatter,
): Effect.Effect<void, BuildFailedError, CommandExecutor.CommandExecutor | Scope.Scope> =>
  Effect.gen(function* () {
    const proc = yield* Command.start(
      cmd.pipe(Command.stdout("pipe"), Command.stderr("pipe")),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new BuildFailedError({
            step,
            exitCode: 1,
            message: `${step} failed to spawn: ${String(cause)}`,
          }),
      ),
    );

    const stdoutFiber = yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => {
        const formatted = formatter.pipe(line);
        return formatted.length > 0
          ? Effect.sync(() => {
              for (const output of formatted) {
                process.stdout.write(output + "\n");
              }
            })
          : Effect.void;
      }),
      Effect.mapError(
        (cause) =>
          new BuildFailedError({
            step,
            exitCode: 1,
            message: `${step} stdout stream error: ${String(cause)}`,
          }),
      ),
      Effect.fork,
    );

    const stderrFiber = yield* proc.stderr.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) => Effect.sync(() => process.stderr.write(line + "\n"))),
      Effect.mapError(
        (cause) =>
          new BuildFailedError({
            step,
            exitCode: 1,
            message: `${step} stderr stream error: ${String(cause)}`,
          }),
      ),
      Effect.fork,
    );

    // Join fibers concurrently — stream errors are non-fatal, exit code takes precedence.
    yield* Effect.all([Fiber.join(stdoutFiber), Fiber.join(stderrFiber)], {
      concurrency: 2,
    }).pipe(Effect.catchAll(() => Effect.void));

    const code = yield* proc.exitCode.pipe(
      Effect.mapError(
        (cause) =>
          new BuildFailedError({
            step,
            exitCode: 1,
            message: `${step} exit code error: ${String(cause)}`,
          }),
      ),
    );

    if (code !== 0) {
      // Print build summary on failure for xcpretty diagnostics
      const summary = formatter.getBuildSummary();
      if (summary) process.stderr.write(summary + "\n");

      return yield* new BuildFailedError({
        step,
        exitCode: code,
        message: `${step} exited with code ${code}`,
      });
    }
  });
