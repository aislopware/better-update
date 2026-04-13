import { Effect } from "effect";

export const safeJsonParse = (text: string): unknown =>
  Effect.runSync(
    Effect.orElseSucceed(
      Effect.try(() => JSON.parse(text) as unknown),
      () => null,
    ),
  );
