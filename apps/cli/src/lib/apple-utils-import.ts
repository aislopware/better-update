import { Effect } from "effect";

/**
 * Dynamically import `@expo/apple-utils`.
 * Returns the module or fails with the provided error.
 */
export const importAppleUtils = <E>(makeError: (message: string) => E) =>
  Effect.tryPromise({
    try: () => import("@expo/apple-utils"),
    catch: () => makeError("Failed to load @expo/apple-utils. Ensure it is installed."),
  });
