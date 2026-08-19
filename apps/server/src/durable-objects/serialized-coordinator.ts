import { DurableObject } from "cloudflare:workers";
import { Effect, Semaphore } from "effect";

export abstract class SerializedCoordinator extends DurableObject {
  // v4 moved the semaphore out of `Effect` into its own module, where the
  // combinators are standalone functions rather than methods. `makeUnsafe`
  // constructs one outside the Effect runtime, so the field needs no `runSync`.
  readonly #semaphore = Semaphore.makeUnsafe(1);

  protected async runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
    return Effect.runPromise(
      Effect.promise(async () => operation()).pipe(Semaphore.withPermit(this.#semaphore)),
    );
  }
}
