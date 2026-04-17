import { it } from "@effect/vitest";
import { Effect } from "effect";

import { CryptoServiceLive } from "../cloudflare/crypto-service";
import { generateInstallToken, verifyInstallToken } from "./install-token";

const TEST_SECRET = "test-secret-key-for-hmac-verification-at-least-32-chars";
const withCrypto = Effect.provide(CryptoServiceLive);

describe("install-token", () => {
  describe(generateInstallToken, () => {
    it.effect("returns a token and expiry timestamp", () =>
      Effect.gen(function* () {
        const result = yield* generateInstallToken("build-123", TEST_SECRET);
        expect(result.token).toBeDefined();
        expectTypeOf(result.token).toBeString();
        expect(result.token.length).toBeGreaterThan(0);
        expectTypeOf(result.expires).toBeNumber();
        expect(result.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
      }).pipe(withCrypto),
    );

    it.effect("generates different tokens for different build IDs", () =>
      Effect.gen(function* () {
        const result1 = yield* generateInstallToken("build-1", TEST_SECRET);
        const result2 = yield* generateInstallToken("build-2", TEST_SECRET);
        expect(result1.token).not.toBe(result2.token);
      }).pipe(withCrypto),
    );

    it.effect("expiry is approximately 1 hour from now", () =>
      Effect.gen(function* () {
        const beforeSeconds = Math.floor(Date.now() / 1000);
        const result = yield* generateInstallToken("build-123", TEST_SECRET);
        const afterSeconds = Math.floor(Date.now() / 1000);
        const oneHour = 3600;
        expect(result.expires).toBeGreaterThanOrEqual(beforeSeconds + oneHour);
        expect(result.expires).toBeLessThanOrEqual(afterSeconds + oneHour);
      }).pipe(withCrypto),
    );
  });

  describe(verifyInstallToken, () => {
    it.effect("returns true for a valid token", () =>
      Effect.gen(function* () {
        const { token, expires } = yield* generateInstallToken("build-123", TEST_SECRET);
        const valid = yield* verifyInstallToken("build-123", token, expires, TEST_SECRET);
        expect(valid).toBe(true);
      }).pipe(withCrypto),
    );

    it.effect("returns false for wrong build ID", () =>
      Effect.gen(function* () {
        const { token, expires } = yield* generateInstallToken("build-123", TEST_SECRET);
        const valid = yield* verifyInstallToken("build-456", token, expires, TEST_SECRET);
        expect(valid).toBe(false);
      }).pipe(withCrypto),
    );

    it.effect("returns false for wrong secret", () =>
      Effect.gen(function* () {
        const { token, expires } = yield* generateInstallToken("build-123", TEST_SECRET);
        const valid = yield* verifyInstallToken(
          "build-123",
          token,
          expires,
          "wrong-secret-key-that-is-also-at-least-32-chars-long",
        );
        expect(valid).toBe(false);
      }).pipe(withCrypto),
    );

    it.effect("returns false for expired token", () =>
      Effect.gen(function* () {
        const { token } = yield* generateInstallToken("build-123", TEST_SECRET);
        const expiredTimestamp = Math.floor(Date.now() / 1000) - 1;
        const valid = yield* verifyInstallToken("build-123", token, expiredTimestamp, TEST_SECRET);
        expect(valid).toBe(false);
      }).pipe(withCrypto),
    );

    it.effect("returns false for tampered token", () =>
      Effect.gen(function* () {
        const { expires } = yield* generateInstallToken("build-123", TEST_SECRET);
        const valid = yield* verifyInstallToken(
          "build-123",
          "tampered-token-value",
          expires,
          TEST_SECRET,
        );
        expect(valid).toBe(false);
      }).pipe(withCrypto),
    );
  });
});
