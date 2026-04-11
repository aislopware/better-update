import { generateInstallToken, verifyInstallToken } from "./install-token";

const TEST_SECRET = "test-secret-key-for-hmac-verification-at-least-32-chars";

describe("install-token", () => {
  describe(generateInstallToken, () => {
    test("returns a token and expiry timestamp", async () => {
      const result = await generateInstallToken("build-123", TEST_SECRET);

      expect(result.token).toBeDefined();
      expectTypeOf(result.token).toBeString();
      expect(result.token.length).toBeGreaterThan(0);
      expectTypeOf(result.expires).toBeNumber();
      expect(result.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    test("generates different tokens for different build IDs", async () => {
      const result1 = await generateInstallToken("build-1", TEST_SECRET);
      const result2 = await generateInstallToken("build-2", TEST_SECRET);

      expect(result1.token).not.toBe(result2.token);
    });

    test("expiry is approximately 1 hour from now", async () => {
      const beforeSeconds = Math.floor(Date.now() / 1000);
      const result = await generateInstallToken("build-123", TEST_SECRET);
      const afterSeconds = Math.floor(Date.now() / 1000);

      const oneHour = 3600;
      expect(result.expires).toBeGreaterThanOrEqual(beforeSeconds + oneHour);
      expect(result.expires).toBeLessThanOrEqual(afterSeconds + oneHour);
    });
  });

  describe(verifyInstallToken, () => {
    test("returns true for a valid token", async () => {
      const { token, expires } = await generateInstallToken("build-123", TEST_SECRET);
      const valid = await verifyInstallToken("build-123", token, expires, TEST_SECRET);

      expect(valid).toBe(true);
    });

    test("returns false for wrong build ID", async () => {
      const { token, expires } = await generateInstallToken("build-123", TEST_SECRET);
      const valid = await verifyInstallToken("build-456", token, expires, TEST_SECRET);

      expect(valid).toBe(false);
    });

    test("returns false for wrong secret", async () => {
      const { token, expires } = await generateInstallToken("build-123", TEST_SECRET);
      const valid = await verifyInstallToken(
        "build-123",
        token,
        expires,
        "wrong-secret-key-that-is-also-at-least-32-chars-long",
      );

      expect(valid).toBe(false);
    });

    test("returns false for expired token", async () => {
      const { token } = await generateInstallToken("build-123", TEST_SECRET);
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 1;
      const valid = await verifyInstallToken("build-123", token, expiredTimestamp, TEST_SECRET);

      expect(valid).toBe(false);
    });

    test("returns false for tampered token", async () => {
      const { expires } = await generateInstallToken("build-123", TEST_SECRET);
      const valid = await verifyInstallToken(
        "build-123",
        "tampered-token-value",
        expires,
        TEST_SECRET,
      );

      expect(valid).toBe(false);
    });
  });
});
