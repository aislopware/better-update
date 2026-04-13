import { Cause, Exit, Option } from "effect";

/**
 * Extract the tagged error from a failed `Effect.exit` result. Returns the
 * first `Fail` value in the cause, or `undefined` for interrupts / dies /
 * success. Use in tests after `Effect.exit` to assert a specific error class.
 */
export const failureError = <E, A>(exit: Exit.Exit<A, E>): E | undefined => {
  if (!Exit.isFailure(exit)) return undefined;
  return Option.getOrUndefined(Cause.failureOption(exit.cause));
};
