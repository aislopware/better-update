import { Result } from "effect";

import { DurableObjectPromiseError, settlePromise } from "./effect-interop";

describe(settlePromise, () => {
  it("returns a right Result on success", async () => {
    const result = await settlePromise(Promise.resolve("ok"));

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toBe("ok");
    }
  });

  it("returns a tagged durable object error on failure", async () => {
    const result = await settlePromise(Promise.reject(new Error("queue down")));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DurableObjectPromiseError);
      expect(result.failure._tag).toBe("DurableObjectPromiseError");
      expect(result.failure.message).toBe("Durable object promise failed");
    }
  });
});
