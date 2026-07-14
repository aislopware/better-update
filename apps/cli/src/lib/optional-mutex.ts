import type { Effect } from "effect";

/**
 * Serialize `self` behind `mutex` when one is provided (parallel
 * `build --platform all` runs), pass it through untouched otherwise. Guards
 * sections two platform-build fibers must not enter together: user-tree
 * writes (app.json autoIncrement) and interactive prompts (credential setup,
 * auto-submit).
 */
export const withOptionalPermit =
  (mutex: Effect.Semaphore | undefined) =>
  <Value, Err, Req>(self: Effect.Effect<Value, Err, Req>): Effect.Effect<Value, Err, Req> =>
    mutex === undefined ? self : mutex.withPermits(1)(self);
