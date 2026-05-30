import process from "node:process";

import { Effect } from "effect";

import { BuildFailedError } from "../../lib/exit-codes";
import { OutputMode } from "../../lib/output-mode";
import { runInPty } from "../../lib/pty-runner";
import { isWarningLine, styleWarningLine } from "../../lib/warning-style";

import type { XcodebuildFormatter } from "../../lib/xcpretty-formatter";

export interface RunStepCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

const buildFailed = (step: string, exitCode: number, message: string) =>
  new BuildFailedError({ step, exitCode, message });

const annotateWarning = (line: string): string | undefined =>
  isWarningLine(line) ? styleWarningLine(line) : undefined;

/**
 * Run a build step in a PTY so the subprocess sees a real TTY (spinners,
 * progress bars, ANSI colors are preserved). Completed lines are inspected
 * and any detected warning is re-echoed with our yellow ⚠ annotation.
 */
export const runStep = (
  cmd: RunStepCommand,
  step: string,
): Effect.Effect<void, BuildFailedError, OutputMode> =>
  runInPty({
    command: cmd.command,
    args: cmd.args,
    cwd: cmd.cwd,
    env: cmd.env,
    onLine: annotateWarning,
  }).pipe(
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(buildFailed(step, code, `${step} exited with code ${code}`)),
    ),
  );

/**
 * Run a build step in a PTY, but feed each completed line through the supplied
 * xcpretty-style formatter before writing. Warning detection still applies to
 * the formatter's output so xcodebuild deprecation notices stand out.
 *
 * The PTY guarantees xcodebuild sees a real TTY (so it keeps colored output);
 * the formatter strips noise. On failure the formatter's build summary is
 * flushed to stderr to help diagnose.
 */
export const runStepFormatted = (
  cmd: RunStepCommand,
  step: string,
  formatter: XcodebuildFormatter,
): Effect.Effect<void, BuildFailedError, OutputMode> =>
  Effect.gen(function* () {
    // JSON mode: the success/error envelope owns stdout, so the formatted native
    // build log is redirected to stderr (acceptable chrome for a stdout-only
    // JSON consumer), mirroring the live-tee redirect in pty-runner.ts.
    const mode = yield* OutputMode;
    const logStream = mode.json ? process.stderr : process.stdout;
    // Hold raw lines back from the live tee — instead, pump them through the
    // formatter and write only what xcpretty decides to keep.
    const code = yield* runInPty({
      command: cmd.command,
      args: cmd.args,
      cwd: cmd.cwd,
      env: cmd.env,
      silent: true,
      onLine: (line) => {
        const formatted = formatter.pipe(line);
        for (const output of formatted) {
          if (isWarningLine(output)) {
            logStream.write(`${styleWarningLine(output)}\n`);
          } else {
            logStream.write(`${output}\n`);
          }
        }
        return undefined;
      },
    });

    if (code !== 0) {
      const summary = formatter.getBuildSummary();
      if (summary.length > 0) {
        process.stderr.write(`${summary}\n`);
      }
      return yield* Effect.fail(buildFailed(step, code, `${step} exited with code ${code}`));
    }
    return undefined;
  });
