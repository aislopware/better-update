import { Either } from "effect";

import { DurableObjectPromiseError, settlePromise } from "./effect-interop";

describe(settlePromise, () => {
  test("returns a right Either on success", async () => {
    const result = await settlePromise(Promise.resolve("ok"));

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toBe("ok");
    }
  });

  test("returns a tagged durable object error on failure", async () => {
    const result = await settlePromise(Promise.reject(new Error("queue down")));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DurableObjectPromiseError);
      expect(result.left._tag).toBe("DurableObjectPromiseError");
      expect(result.left.message).toBe("Durable object promise failed");
    }
  });
});
