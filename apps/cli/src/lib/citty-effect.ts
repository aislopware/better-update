import { Effect } from "effect";

import { CliLive } from "../app-layer";
import { makeCommandErrorHandler } from "./command-errors";

type ExtraExitMap = Parameters<typeof makeCommandErrorHandler>[0];

export const runEffect = async <Value, Err, Req>(
  effect: Effect.Effect<Value, Err, Req>,
  extras: ExtraExitMap = {},
): Promise<void> => {
  const handled = makeCommandErrorHandler(extras)(effect);
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CliLive provides every service the CLI handlers require; after makeCommandErrorHandler's catch-all the failure channel is `never`
  const provided = handled.pipe(Effect.provide(CliLive)) as Effect.Effect<Value>;
  return Effect.runPromise(provided.pipe(Effect.asVoid));
};
