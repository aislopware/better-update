import { Effect } from "effect";

/**
 * Read a required string field out of a decrypted credential secret, failing via
 * the caller's own error constructor when it is absent or not a string. Every
 * credential consumer (download, pull, build, the interactive manager) hand-rolled
 * this same guard, differing only in which error channel they fail into — this
 * centralizes the check and lets each keep its own error type.
 */
export const requireSecretString = <Err>(
  secret: Record<string, unknown>,
  key: string,
  onMissing: (key: string) => Err,
): Effect.Effect<string, Err> => {
  const value = secret[key];
  return typeof value === "string" ? Effect.succeed(value) : Effect.fail(onMissing(key));
};
