import { Semaphore } from "effect";

import type { Effect } from "effect";

/**
 * Serialize `self` behind `mutex` when one is provided (parallel
 * `build --platform all` runs), pass it through untouched otherwise. Guards
 * sections two platform-build fibers must not enter together: user-tree
 * writes (app.json autoIncrement) and interactive prompts (credential setup,
 * auto-submit).
 */
export const withOptionalPermit =
  (mutex: Semaphore.Semaphore | undefined) =>
  <Value, Err, Req>(self: Effect.Effect<Value, Err, Req>): Effect.Effect<Value, Err, Req> =>
    // v4 moved the semaphore combinators off the value and into the module.
    mutex === undefined ? self : Semaphore.withPermit(mutex)(self);
