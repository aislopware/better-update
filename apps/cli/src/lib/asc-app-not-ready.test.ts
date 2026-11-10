import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  APP_NOT_READY_CODE,
  APP_NOT_READY_WAIT_ENV,
  appNotReadyBudgetMillis,
  appNotReadyDelayMillis,
  isAltoolAppNotReady,
  isAppNotReadyConflict,
  retryWhileAppNotReady,
} from "./asc-app-not-ready";
import { makeOutputModeLayer } from "./output-mode";

describe(isAppNotReadyConflict, () => {
  it("matches a 409 with the relationship-invalid code", () => {
    expect(isAppNotReadyConflict(409, [{ code: "ENTITY_ERROR.RELATIONSHIP.INVALID" }])).toBe(true);
  });

  it("matches a 409 by Apple's detail text alone", () => {
    expect(
      isAppNotReadyConflict(409, [
        { code: "ENTITY_ERROR", detail: "'6000000000' is not a valid ID for this relationship." },
      ]),
    ).toBe(true);
  });

  it("ignores the duplicate-build conflict and other statuses", () => {
    expect(isAppNotReadyConflict(409, [{ code: "ENTITY_ERROR.ATTRIBUTE.INVALID.DUPLICATE" }])).toBe(
      false,
    );
    expect(isAppNotReadyConflict(422, [{ code: "ENTITY_ERROR.RELATIONSHIP.INVALID" }])).toBe(false);
  });
});

describe(isAltoolAppNotReady, () => {
  it("matches altool's invalid-relationship failure", () => {
    expect(
      isAltoolAppNotReady("The provided entity includes a relationship with an invalid value"),
    ).toBe(true);
    expect(isAltoolAppNotReady("Redundant Binary Upload")).toBe(false);
  });
});

describe(appNotReadyBudgetMillis, () => {
  it("defaults to 30 minutes", () => {
    expect(appNotReadyBudgetMillis({})).toBe(30 * 60_000);
    expect(appNotReadyBudgetMillis({ [APP_NOT_READY_WAIT_ENV]: "soon" })).toBe(30 * 60_000);
  });

  it("reads minutes from the env, 0 turning the wait off", () => {
    expect(appNotReadyBudgetMillis({ [APP_NOT_READY_WAIT_ENV]: "5" })).toBe(5 * 60_000);
    expect(appNotReadyBudgetMillis({ [APP_NOT_READY_WAIT_ENV]: "0" })).toBe(0);
  });
});

describe(appNotReadyDelayMillis, () => {
  it("doubles from 15s and caps at 2 min", () => {
    expect([0, 1, 2, 3, 4].map(appNotReadyDelayMillis)).toStrictEqual([
      15_000, 30_000, 60_000, 120_000, 120_000,
    ]);
  });
});

const notReady = { _tag: "Fail", code: APP_NOT_READY_CODE } as const;

/** An upload that fails not-ready `failures` times, then succeeds; counts calls. */
const flakyUpload = (failures: number) => {
  let calls = 0;
  const upload = Effect.suspend(() => {
    calls += 1;
    return calls <= failures ? Effect.fail(notReady) : Effect.succeed("uploaded");
  });
  return { upload, calls: () => calls };
};

describe(retryWhileAppNotReady, () => {
  it.effect("waits out not-ready failures, then returns the upload's result", () =>
    Effect.gen(function* () {
      const flaky = flakyUpload(2);
      const fiber = yield* Effect.forkChild(
        retryWhileAppNotReady(flaky.upload, { appId: "app-1", budgetMillis: 30 * 60_000 }),
      );
      yield* TestClock.adjust("15 seconds");
      yield* TestClock.adjust("30 seconds");
      expect(yield* Fiber.join(fiber)).toBe("uploaded");
      expect(flaky.calls()).toBe(3);
    }).pipe(Effect.provide(makeOutputModeLayer(true))),
  );

  it.effect("surfaces the failure once the next retry would pass the budget", () =>
    Effect.gen(function* () {
      const flaky = flakyUpload(Number.POSITIVE_INFINITY);
      const fiber = yield* Effect.forkChild(
        Effect.flip(retryWhileAppNotReady(flaky.upload, { appId: null, budgetMillis: 60_000 })),
      );
      yield* TestClock.adjust("15 seconds");
      yield* TestClock.adjust("30 seconds");
      expect(yield* Fiber.join(fiber)).toBe(notReady);
      // 0s, 15s, 45s; a fourth try (after 60s more) would pass the 60s budget.
      expect(flaky.calls()).toBe(3);
    }).pipe(Effect.provide(makeOutputModeLayer(true))),
  );

  it.effect("does not retry other failures or when the budget is 0", () =>
    Effect.gen(function* () {
      const other = { _tag: "Fail", code: "OTHER" } as const;
      expect(
        yield* Effect.flip(
          retryWhileAppNotReady(Effect.fail(other), { appId: null, budgetMillis: 60_000 }),
        ),
      ).toBe(other);
      const flaky = flakyUpload(1);
      expect(
        yield* Effect.flip(retryWhileAppNotReady(flaky.upload, { appId: null, budgetMillis: 0 })),
      ).toBe(notReady);
      expect(flaky.calls()).toBe(1);
    }).pipe(Effect.provide(makeOutputModeLayer(true))),
  );
});
