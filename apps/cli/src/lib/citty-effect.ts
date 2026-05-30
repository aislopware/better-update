import { Console, Effect } from "effect";

import { CliLive } from "../app-layer";
import { runLogin } from "../application/login";
import { makeCommandErrorHandler } from "./command-errors";
import { resolveActiveCommandName } from "./command-output";
import { makeSuccessEnvelope, serializeEnvelope } from "./envelope";
import { InteractiveMode } from "./interactive-mode";
import { OutputMode } from "./output-mode";

type CliLayer = typeof CliLive;
type ExtraExitMap = NonNullable<Parameters<typeof makeCommandErrorHandler>[0]>;

/**
 * How `--json` mode renders a command's success value into the envelope `data`.
 *
 * - omitted: the command already side-effected its JSON via the `output.ts`
 *   helpers (printJson/printTable/...), which now emit the envelope themselves.
 *   This is the default, zero-churn path.
 * - `"value"`: the effect's success value IS the envelope `data` — the boundary
 *   wraps + emits it once. Use this for new commands so they are JSON-correct
 *   the moment they `return` their result, with no `--json` branch in the body.
 * - `(value) => unknown`: project the success value into the envelope `data`.
 */
type JsonPresenter<Value> = "value" | ((value: Value) => unknown);

interface RunEffectOptions<Value> {
  /** Per-command extra `tag → exit code` mappings, merged onto the base map. */
  readonly exits?: ExtraExitMap;
  /** Render the success value into the JSON envelope at the boundary. */
  readonly json?: JsonPresenter<Value>;
}

// Active CLI layer. Defaults to CliLive (human-readable, interactive); the
// entry point overrides this with `setActiveCliLayer(makeCliLive({...}))`
// after parsing global flags so subcommands inherit the correct OutputMode
// and InteractiveMode services.
let activeCliLayer: CliLayer = CliLive;

export const setActiveCliLayer = (layer: CliLayer): void => {
  activeCliLayer = layer;
};

const isAuthRequiredError = (
  error: unknown,
): error is { readonly _tag: "AuthRequiredError"; readonly message: string } =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error as { readonly _tag: unknown })._tag === "AuthRequiredError";

const wrapWithAutoLogin = <Value, Err, Req>(effect: Effect.Effect<Value, Err, Req>) => {
  const attempt = (depth: number): Effect.Effect<Value, Err, Req> =>
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- catchAll widens Req to include the login deps which CliLive provides at runEffect boundary
    effect.pipe(
      Effect.catchAll((cause) => {
        if (depth >= 1 || !isAuthRequiredError(cause)) {
          return Effect.fail(cause);
        }
        return Effect.gen(function* () {
          const mode = yield* InteractiveMode;
          if (!mode.allow) {
            return yield* Effect.fail(cause);
          }
          yield* Console.log("");
          yield* Console.log("Authentication required.");
          yield* runLogin({ manualApiKey: false });
          yield* Console.log("");
          return yield* attempt(depth + 1);
        });
      }),
    ) as Effect.Effect<Value, Err, Req>;
  return attempt(0);
};

const isRunEffectOptions = <Value>(
  value: RunEffectOptions<Value> | ExtraExitMap,
): value is RunEffectOptions<Value> => "exits" in value || "json" in value;

const normalizeOptions = <Value>(
  optsOrExtras: RunEffectOptions<Value> | ExtraExitMap = {},
): RunEffectOptions<Value> =>
  // Backward-compat: a bare `tag → code` map is the legacy 2nd arg. Detect the
  // new shape by its `exits`/`json` keys; otherwise treat the value as `exits`.
  isRunEffectOptions(optsOrExtras) ? optsOrExtras : { exits: optsOrExtras };

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
    const data = json === "value" ? value : json(value);
    const envelope = makeSuccessEnvelope(resolveActiveCommandName(process.argv), data);
    yield* Console.log(serializeEnvelope(envelope));
  });

export const runEffect = async <Value, Err, Req>(
  effect: Effect.Effect<Value, Err, Req>,
  optsOrExtras: RunEffectOptions<Value> | ExtraExitMap = {},
): Promise<void> => {
  const { exits = {}, json } = normalizeOptions<Value>(optsOrExtras);
  // Present the success envelope BEFORE the error handler so it only fires on the
  // genuine success path. The handler maps failures to a void-returning exitWith,
  // so tapping after it would emit a spurious success envelope post-error.
  const withSuccess = wrapWithAutoLogin(effect).pipe(
    Effect.tap((value) => presentSuccess(value, json)),
  );
  const handled = makeCommandErrorHandler(exits)(withSuccess);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- activeCliLayer provides every service handlers require; after makeCommandErrorHandler the failure channel is `never`
  const provided = handled.pipe(Effect.provide(activeCliLayer)) as Effect.Effect<Value>;
  return Effect.runPromise(provided.pipe(Effect.asVoid));
};
