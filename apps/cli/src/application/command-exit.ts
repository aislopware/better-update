import { Console, Effect } from "effect";

import { CliRuntime } from "../services/cli-runtime";

export const exitWith = (code: number, message: string): Effect.Effect<void, never, CliRuntime> =>
  Console.error(message).pipe(
    Effect.zipRight(
      Effect.gen(function* () {
        const runtime = yield* CliRuntime;
        yield* runtime.setExitCode(code);
      }),
    ),
  );
