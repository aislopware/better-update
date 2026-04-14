import { Data, Effect } from "effect";

export class DurableObjectPromiseError extends Data.TaggedError("DurableObjectPromiseError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export const settlePromise = async <Value>(promise: Promise<Value>) =>
  Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => promise,
        catch: (cause) =>
          new DurableObjectPromiseError({
            message: "Durable object promise failed",
            cause,
          }),
      }),
    ),
  );
