import { it } from "@effect/vitest";
import { Effect } from "effect";

import { CryptoServiceLive } from "../cloudflare/crypto-service";
import { collectServableUpdates, resolveUpdateRollout } from "./update-rollout";

// Pre-computed hash fractions (SHA-256, deterministic):
//   HashToFraction("update-1", "client-c")  ≈ 0.2048  → below 0.50 (in 50% rollout)
//   HashToFraction("update-1", "client-a")  ≈ 0.7523  → above 0.50 (not in 50% rollout)
//   HashToFraction("update-0", "device-5")  ≈ 0.0313  → below 0.30 (in 30% rollout)
//   HashToFraction("update-0", "client-a")  ≈ 0.3240  → above 0.30 (not in 30% rollout)

const candidate = (id: string, rollout: number) => ({ id, rollout_percentage: rollout });

const withCrypto = Effect.provide(CryptoServiceLive);

describe(collectServableUpdates, () => {
  test("returns all updates that remain servable through a partial rollout chain", () => {
    expect(
      collectServableUpdates([
        candidate("latest-canary", 50),
        candidate("previous-stable", 100),
        candidate("older-stable", 100),
      ]),
    ).toEqual([candidate("latest-canary", 50), candidate("previous-stable", 100)]);
  });

  test("skips reverted updates and keeps searching until a fully rolled out fallback", () => {
    expect(
      collectServableUpdates([
        candidate("latest-reverted", 0),
        candidate("previous-reverted", 0),
        candidate("stable", 100),
      ]),
    ).toEqual([candidate("stable", 100)]);
  });

  test("returns an empty array when no candidate is servable", () => {
    expect(collectServableUpdates([candidate("latest-reverted", 0)])).toEqual([]);
  });
});

describe(resolveUpdateRollout, () => {
  it.effect("returns null for empty candidates", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout([], "client-c");
      expect(result).toBeNull();
    }).pipe(withCrypto),
  );

  it.effect("single candidate at 100% resolves immediately", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout([candidate("update-1", 100)], "client-c");
      expect(result).toEqual({ resolved: true, update: candidate("update-1", 100) });
    }).pipe(withCrypto),
  );

  it.effect("latest at 0% with previous at 100% resolves to previous", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout(
        [candidate("update-1", 0), candidate("update-0", 100)],
        "client-c",
      );
      expect(result).toEqual({ resolved: true, update: candidate("update-0", 100) });
    }).pipe(withCrypto),
  );

  it.effect("latest at 0% with no previous returns no-update", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout([candidate("update-1", 0)], "client-c");
      expect(result).toEqual({ resolved: false, needsFallbackQuery: false });
    }).pipe(withCrypto),
  );

  it.effect("latest at 0% with previous at 0% needs fallback query", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout(
        [candidate("update-1", 0), candidate("update-0", 0)],
        "client-c",
      );
      expect(result).toEqual({ resolved: false, needsFallbackQuery: true });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, device in rollout resolves to latest", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout([candidate("update-1", 50)], "client-c");
      expect(result).toEqual({ resolved: true, update: candidate("update-1", 50) });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, device not in rollout, previous at 100% resolves to previous", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout(
        [candidate("update-1", 50), candidate("update-0", 100)],
        "client-a",
      );
      expect(result).toEqual({ resolved: true, update: candidate("update-0", 100) });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, device not in rollout, no previous returns no-update", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout([candidate("update-1", 50)], "client-a");
      expect(result).toEqual({ resolved: false, needsFallbackQuery: false });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, no easClientId falls back to previous", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout(
        [candidate("update-1", 50), candidate("update-0", 100)],
        undefined,
      );
      expect(result).toEqual({ resolved: true, update: candidate("update-0", 100) });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, no easClientId, previous at 30% serves previous directly", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout(
        [candidate("update-1", 50), candidate("update-0", 30)],
        undefined,
      );
      expect(result).toEqual({ resolved: true, update: candidate("update-0", 30) });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, no easClientId, no previous returns no-update", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout([candidate("update-1", 50)], undefined);
      expect(result).toEqual({ resolved: false, needsFallbackQuery: false });
    }).pipe(withCrypto),
  );

  it.effect("latest at 50%, device not in rollout, previous at 0% needs fallback query", () =>
    Effect.gen(function* () {
      const result = yield* resolveUpdateRollout(
        [candidate("update-1", 50), candidate("update-0", 0)],
        "client-a",
      );
      expect(result).toEqual({ resolved: false, needsFallbackQuery: true });
    }).pipe(withCrypto),
  );

  it.effect(
    "latest at 50%, device not in rollout, previous at 30%, device in prev resolves to previous",
    () =>
      Effect.gen(function* () {
        const result = yield* resolveUpdateRollout(
          [candidate("update-1", 50), candidate("update-0", 30)],
          "device-5",
        );
        expect(result).toEqual({ resolved: true, update: candidate("update-0", 30) });
      }).pipe(withCrypto),
  );

  it.effect(
    "latest at 50%, device not in rollout, previous at 30%, device not in prev needs fallback query",
    () =>
      Effect.gen(function* () {
        const result = yield* resolveUpdateRollout(
          [candidate("update-1", 50), candidate("update-0", 30)],
          "client-a",
        );
        expect(result).toEqual({ resolved: false, needsFallbackQuery: true });
      }).pipe(withCrypto),
  );
});
