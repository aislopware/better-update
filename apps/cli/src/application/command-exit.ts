import { Console, Effect } from "effect";

import { resolveActiveCommandName } from "../lib/command-output";
import { makeErrorEnvelope, serializeEnvelope } from "../lib/envelope";
import { OutputMode } from "../lib/output-mode";
import { CliRuntime } from "../services/cli-runtime";

export interface ExitFailure {
  /** The failed value's `_tag`, or `"Unknown"` for the catchAll fallback. */
  readonly tag: string;
  /** Human-readable failure message. */
  readonly message: string;
  /** Optional actionable remediation hint. */
  readonly hint?: string | undefined;
}

/**
 * Single error-emission site for every command. OutputMode-aware:
 *
 * - Human mode: print the message on stderr + set the exit code (unchanged).
 * - JSON mode: print the schema-versioned ERROR envelope on stdout (so a single
 *   stdout parser reads `ok:false` from the same stream consumers read success
 *   from) + set the exit code. The human stderr line is suppressed so stdout
 *   stays a pure envelope.
 *
 * The exit code is the single source of truth, surfaced as `error.code`.
 */
export const exitWith = (
  code: number,
  failure: ExitFailure,
): Effect.Effect<void, never, CliRuntime | OutputMode> =>
  Effect.gen(function* () {
    const mode = yield* OutputMode;
    if (mode.json) {
      const envelope = makeErrorEnvelope(resolveActiveCommandName(process.argv), {
        code,
        tag: failure.tag,
        message: failure.message,
        hint: failure.hint,
      });
      yield* Console.log(serializeEnvelope(envelope));
    } else {
      yield* Console.error(failure.message);
    }
    const runtime = yield* CliRuntime;
    yield* runtime.setExitCode(code);
  });
