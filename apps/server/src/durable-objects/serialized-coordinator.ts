import { DurableObject } from "cloudflare:workers";
import { Effect } from "effect";

export abstract class SerializedCoordinator extends DurableObject {
  readonly #semaphore = Effect.runSync(Effect.makeSemaphore(1));

  protected async runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
    return Effect.runPromise(
      Effect.promise(async () => operation()).pipe(this.#semaphore.withPermits(1)),
    );
  }
}
