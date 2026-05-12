import { Effect } from "effect";

import { CliLive } from "../app-layer";
import { makeCommandErrorHandler } from "./command-errors";

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

export const runEffect = async <Value, Err, Req>(
  effect: Effect.Effect<Value, Err, Req>,
  extras: ExtraExitMap = {},
): Promise<void> => {
  const handled = makeCommandErrorHandler(extras)(effect);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- activeCliLayer provides every service handlers require; after makeCommandErrorHandler the failure channel is `never`
  const provided = handled.pipe(Effect.provide(activeCliLayer)) as Effect.Effect<Value>;
  return Effect.runPromise(provided.pipe(Effect.asVoid));
};
