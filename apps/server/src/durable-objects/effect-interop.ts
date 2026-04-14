import { Effect } from "effect";

export const settlePromise = async <Value>(promise: Promise<Value>) =>
  Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => promise,
        catch: (error) => error,
      }),
    ),
  );
