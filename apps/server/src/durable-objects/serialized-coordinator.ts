import { DurableObject } from "cloudflare:workers";

export abstract class SerializedCoordinator extends DurableObject {
  #pendingOperation: Promise<undefined> = Promise.resolve(undefined);

  protected async runExclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
    const previousOperation = this.#pendingOperation;
    const nextOperation = Promise.withResolvers<undefined>();
    this.#pendingOperation = nextOperation.promise;

    await Promise.allSettled([previousOperation]);

    const operationResult = operation();
    const [settledOperation] = await Promise.allSettled([operationResult]);
    nextOperation.resolve(undefined);

    if (settledOperation.status === "fulfilled") {
      return settledOperation.value;
    }

    return operationResult;
  }
}
