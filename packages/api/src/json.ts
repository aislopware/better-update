import { Data, Effect } from "effect";

class SafeJsonParseError extends Data.TaggedError("SafeJsonParseError")<{
  readonly message: string;
}> {}

export const safeJsonParse = (text: string): unknown =>
  Effect.runSync(
    Effect.orElseSucceed(
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => new SafeJsonParseError({ message: "Invalid JSON" }),
      }),
      () => null,
    ),
  );
