import { it } from "@effect/vitest";
import { Effect, Either } from "effect";

import { PasskeyStepUpRepo } from "../repositories/passkey-step-up";
import { assertWebEnvStepUp, WEB_ENV_STEP_UP_TTL_MS } from "./assert-web-env-step-up";

const NOW = Date.parse("2026-06-29T00:10:00.000Z");

const repo = (record: { readonly verifiedAt: string } | null) =>
  PasskeyStepUpRepo.of({
    record: () => Effect.void,
    findBySession: () => Effect.succeed(record),
  });

const run = (
  actor: { transport: "bearer" | "cookie"; sessionId: string | null },
  record: { readonly verifiedAt: string } | null,
) =>
  assertWebEnvStepUp(actor, { nowMs: NOW }).pipe(
    Effect.provideService(PasskeyStepUpRepo, repo(record)),
    Effect.either,
  );

describe(assertWebEnvStepUp, () => {
  it.effect("a CLI (bearer) caller is exempt — passes with no step-up record", () =>
    Effect.gen(function* () {
      const result = yield* run({ transport: "bearer", sessionId: null }, null);
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect("a browser session with a fresh step-up passes", () =>
    Effect.gen(function* () {
      const verifiedAt = new Date(NOW - WEB_ENV_STEP_UP_TTL_MS + 60_000).toISOString();
      const result = yield* run({ transport: "cookie", sessionId: "s1" }, { verifiedAt });
      expect(Either.isRight(result)).toBe(true);
    }),
  );

  it.effect("a browser session with a stale step-up is rejected", () =>
    Effect.gen(function* () {
      const verifiedAt = new Date(NOW - WEB_ENV_STEP_UP_TTL_MS - 60_000).toISOString();
      const result = yield* run({ transport: "cookie", sessionId: "s1" }, { verifiedAt });
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("a browser session with NO step-up record is rejected", () =>
    Effect.gen(function* () {
      const result = yield* run({ transport: "cookie", sessionId: "s1" }, null);
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("a browser session with no session id is rejected (fails closed)", () =>
    Effect.gen(function* () {
      const result = yield* run({ transport: "cookie", sessionId: null }, null);
      expect(Either.isLeft(result)).toBe(true);
    }),
  );

  it.effect("an unparseable verified-at timestamp is rejected (fails closed)", () =>
    Effect.gen(function* () {
      const result = yield* run(
        { transport: "cookie", sessionId: "s1" },
        { verifiedAt: "not-a-date" },
      );
      expect(Either.isLeft(result)).toBe(true);
    }),
  );
});
