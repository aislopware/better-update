import { createAssetUploadToken, verifyAssetUploadToken } from "./asset-upload-token";

import type { AssetUploadTokenPayload } from "./asset-upload-token";

const TEST_SECRET = "test-secret-key-for-hmac-verification-at-least-32-chars";

const validPayload = (overrides?: Partial<AssetUploadTokenPayload>): AssetUploadTokenPayload => ({
  hash: "sha256-abc123",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  ...overrides,
});

describe("asset-upload-token", () => {
  describe(createAssetUploadToken, () => {
    test("returns a dot-separated token", async () => {
      const token = await createAssetUploadToken(validPayload(), TEST_SECRET);

      expect(token).toContain(".");
      const parts = token.split(".");
      expect(parts).toHaveLength(2);
      expect(parts[0]!.length).toBeGreaterThan(0);
      expect(parts[1]!.length).toBeGreaterThan(0);
    });

    test("generates different signatures for different payloads", async () => {
      const token1 = await createAssetUploadToken(validPayload({ hash: "hash-1" }), TEST_SECRET);
      const token2 = await createAssetUploadToken(validPayload({ hash: "hash-2" }), TEST_SECRET);

      expect(token1).not.toBe(token2);
    });
  });

  describe(verifyAssetUploadToken, () => {
    test("returns payload for a valid token", async () => {
      const payload = validPayload();
      const token = await createAssetUploadToken(payload, TEST_SECRET);
      const result = await verifyAssetUploadToken(token, TEST_SECRET);

      expect(result).toEqual(payload);
    });

    test("returns null for wrong secret", async () => {
      const token = await createAssetUploadToken(validPayload(), TEST_SECRET);
      const result = await verifyAssetUploadToken(
        token,
        "wrong-secret-key-that-is-also-at-least-32-chars-long",
      );

      expect(result).toBeNull();
    });

    test("returns null for tampered signature", async () => {
      const token = await createAssetUploadToken(validPayload(), TEST_SECRET);
      const [payloadPart] = token.split(".");
      const tampered = `${payloadPart}.AAAA_tampered_signature`;
      const result = await verifyAssetUploadToken(tampered, TEST_SECRET);

      expect(result).toBeNull();
    });

    test("returns null for tampered payload", async () => {
      const token = await createAssetUploadToken(validPayload(), TEST_SECRET);
      const [, signaturePart] = token.split(".");
      const tampered = `dGFtcGVyZWQ.${signaturePart}`;
      const result = await verifyAssetUploadToken(tampered, TEST_SECRET);

      expect(result).toBeNull();
    });

    test("returns null for expired token", async () => {
      const payload = validPayload({ expiresAt: new Date(Date.now() - 1000).toISOString() });
      const token = await createAssetUploadToken(payload, TEST_SECRET);
      const result = await verifyAssetUploadToken(token, TEST_SECRET);

      expect(result).toBeNull();
    });

    test("returns null for missing dot separator", async () => {
      const result = await verifyAssetUploadToken("no-dot-separator", TEST_SECRET);

      expect(result).toBeNull();
    });

    test("returns null for empty string", async () => {
      const result = await verifyAssetUploadToken("", TEST_SECRET);

      expect(result).toBeNull();
    });

    test("returns null for invalid base64 payload with valid signature shape", async () => {
      const result = await verifyAssetUploadToken("!!!invalid.AAAA", TEST_SECRET);

      expect(result).toBeNull();
    });
  });
});
