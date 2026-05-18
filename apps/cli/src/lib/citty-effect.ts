import { Console, Effect } from "effect";

import { CliLive } from "../app-layer";
import { runLogin } from "../application/login";
import { makeCommandErrorHandler } from "./command-errors";
import { InteractiveMode } from "./interactive-mode";

type CliLayer = typeof CliLive;
type ExtraExitMap = Parameters<typeof makeCommandErrorHandler>[0];

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

export const runEffect = async <Value, Err, Req>(
  effect: Effect.Effect<Value, Err, Req>,
  extras: ExtraExitMap = {},
): Promise<void> => {
  const handled = makeCommandErrorHandler(extras)(wrapWithAutoLogin(effect));
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- activeCliLayer provides every service handlers require; after makeCommandErrorHandler the failure channel is `never`
  const provided = handled.pipe(Effect.provide(activeCliLayer)) as Effect.Effect<Value>;
  return Effect.runPromise(provided.pipe(Effect.asVoid));
};
