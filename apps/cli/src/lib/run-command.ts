import { Console, Effect } from "effect";

import { runLogin } from "../application/login";
import { handleCommandErrors } from "./command-errors";
import { activeCommandName } from "./command-output";
import { makeSuccessEnvelope, serializeEnvelope } from "./envelope";
import { InteractiveMode } from "./interactive-mode";
import { OutputMode } from "./output-mode";

import type { CliRuntime } from "../services/cli-runtime";

type LoginEffect = ReturnType<typeof runLogin>;
type LoginRequirements = Effect.Services<LoginEffect>;
type LoginFailure = Effect.Error<LoginEffect>;

/**
 * How `--json` mode renders a command's success value into the envelope `data`.
 *
 * - omitted: the command already side-effected its JSON via the `output.ts`
 *   helpers (printJson/printTable/...), which emit the envelope themselves.
 * - `"value"`: the effect's success value IS the envelope `data` — the boundary
 *   wraps + emits it once. Use this for new commands so they are JSON-correct
 *   the moment they `return` their result, with no `--json` branch in the body.
 * - `(value) => unknown`: project the success value into the envelope `data`.
 */
type JsonPresenter<Value> = "value" | ((value: Value) => unknown);

export interface RunCommandOptions<Value> {
  /** Render the success value into the JSON envelope at the boundary. */
  readonly json?: JsonPresenter<Value>;
}

export type CommandServices = InteractiveMode | OutputMode | CliRuntime | LoginRequirements;

const isAuthRequiredError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  error._tag === "AuthRequiredError";

const withAutoLogin = <Value, Err, Req>(
  effect: Effect.Effect<Value, Err, Req>,
): Effect.Effect<Value, Err | LoginFailure, Req | InteractiveMode | LoginRequirements> => {
  const attempt = (
    depth: number,
  ): Effect.Effect<Value, Err | LoginFailure, Req | InteractiveMode | LoginRequirements> =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const mode = yield* InteractiveMode;
          if (depth >= 1 || !mode.allow || !isAuthRequiredError(error)) {
            return yield* Effect.fail(error);
          }
          yield* Console.log("");
          yield* Console.log("Authentication required.");
          yield* runLogin({ manualApiKey: false });
          yield* Console.log("");
          return yield* attempt(depth + 1);
        }),
      ),
    );
  return attempt(0);
};

/**
 * Wrap a command's success value in the schema-versioned success envelope when
 * the command opted into the return-value JSON path (`json` option). In human
 * mode (or when no presenter is given) the value passes through untouched — the
 * command already side-effected human output.
 */
const presentSuccess = <Value>(
  value: Value,
  json: JsonPresenter<Value> | undefined,
): Effect.Effect<void, never, OutputMode> =>
  Effect.gen(function* () {
    if (json === undefined) {
      return;
    }
    const mode = yield* OutputMode;
    if (!mode.json) {
      return;
    }
    const command = yield* activeCommandName;
    const data = json === "value" ? value : json(value);
    yield* Console.log(serializeEnvelope(makeSuccessEnvelope(command, data)));
  });

/**
 * The single command boundary; every leaf handler ends in `runCommand(...)`.
 * It retries once through the login flow on `AuthRequiredError`, emits the
 * success envelope in `--json` mode, and maps every failure to its exit code +
 * error envelope so the handler's failure channel is `never`. Prompt
 * cancellation (Ctrl-C) travels as fiber interruption and exits 130 via the
 * runtime, never through this boundary.
 */
export const runCommand =
  <Value = unknown>(options: RunCommandOptions<Value> = {}) =>
  <Err, Req>(
    effect: Effect.Effect<Value, Err, Req>,
  ): Effect.Effect<void, never, Req | CommandServices> =>
    withAutoLogin(effect).pipe(
      // Present the success envelope BEFORE the error handler so it only fires
      // on the genuine success path: the handler maps failures to a
      // void-returning exitWith, so tapping after it would emit a spurious
      // success envelope post-error.
      Effect.tap((value) => presentSuccess(value, options.json)),
      handleCommandErrors,
    );
