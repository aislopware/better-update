import {
  decryptAesGcm,
  decryptSecret,
  encryptAesGcm,
  encryptSecret,
  envelopeDecrypt,
  envelopeEncrypt,
  fromBase64,
  resolveKeyring,
  toBase64,
} from "./credential-vault";

import type { Keyring } from "./credential-vault";

const makeTestKeyring = (): Keyring => {
  const secret1 = crypto.getRandomValues(new Uint8Array(32));
  const secret2 = crypto.getRandomValues(new Uint8Array(32));
  return {
    secrets: { 1: secret1, 2: secret2 },
    currentVersion: 2,
  };
};

describe("credential-vault", () => {
  describe(resolveKeyring, () => {
    test("parses valid keyring JSON", () => {
      const secret = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      const json = JSON.stringify({ "1": secret });
      const keyring = resolveKeyring(json);

      expect(keyring.currentVersion).toBe(1);
      expect(keyring.secrets[1]).toBeInstanceOf(Uint8Array);
      expect(keyring.secrets[1]!.length).toBe(32);
    });

    test("selects highest version as currentVersion", () => {
      const s1 = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      const s2 = toBase64(crypto.getRandomValues(new Uint8Array(32)));
      const json = JSON.stringify({ "1": s1, "3": s2 });
      const keyring = resolveKeyring(json);

      expect(keyring.currentVersion).toBe(3);
    });

    test("throws on empty keyring", () => {
      expect(() => resolveKeyring("{}")).toThrow("Vault keyring is empty");
    });

    test("throws on invalid JSON", () => {
      expect(() => resolveKeyring("not-json")).toThrow();
    });
  });

  describe("encryptAesGcm / decryptAesGcm", () => {
    test("round-trips plaintext", async () => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
        "decrypt",
      ]);
      const plaintext = new TextEncoder().encode("hello world");
      const encrypted = await encryptAesGcm(key, plaintext);
      const decrypted = await decryptAesGcm(key, encrypted);

      expect(new TextDecoder().decode(decrypted)).toBe("hello world");
    });

    test("produces different ciphertexts for same plaintext (random IV)", async () => {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
        "encrypt",
        "decrypt",
      ]);
      const plaintext = new TextEncoder().encode("same input");
      const encrypted1 = await encryptAesGcm(key, plaintext);
      const encrypted2 = await encryptAesGcm(key, plaintext);

      expect(toBase64(encrypted1)).not.toBe(toBase64(encrypted2));
    });
  });

  describe("envelopeEncrypt / envelopeDecrypt", () => {
    test("round-trips binary data", async () => {
      const keyring = makeTestKeyring();
      const orgId = "org-test-123";
      const plaintext = new TextEncoder().encode("secret file contents");

      const result = await envelopeEncrypt(keyring, orgId, plaintext);

      expect(result.keyVersion).toBe(keyring.currentVersion);
      expect(result.encryptedBlob.length).toBeGreaterThan(0);
      expect(result.encryptedDek.length).toBeGreaterThan(0);

      const decrypted = await envelopeDecrypt(
        keyring,
        orgId,
        result.keyVersion,
        result.encryptedDek,
        result.encryptedBlob,
      );

      expect(new TextDecoder().decode(decrypted)).toBe("secret file contents");
    });

    test("different orgIds produce different ciphertexts", async () => {
      const keyring = makeTestKeyring();
      const plaintext = new TextEncoder().encode("same data");

      const result1 = await envelopeEncrypt(keyring, "org-alpha", plaintext);
      const result2 = await envelopeEncrypt(keyring, "org-beta", plaintext);

      expect(result1.encryptedDek).not.toBe(result2.encryptedDek);
    });

    test("decryption fails with wrong orgId", async () => {
      const keyring = makeTestKeyring();
      const plaintext = new TextEncoder().encode("secret");

      const result = await envelopeEncrypt(keyring, "org-correct", plaintext);

      await expect(
        envelopeDecrypt(
          keyring,
          "org-wrong",
          result.keyVersion,
          result.encryptedDek,
          result.encryptedBlob,
        ),
      ).rejects.toThrow();
    });
  });

  describe("encryptSecret / decryptSecret", () => {
    test("round-trips a string secret", async () => {
      const keyring = makeTestKeyring();
      const orgId = "org-test-456";
      const secret = "my-super-secret-password";

      const { encrypted, keyVersion } = await encryptSecret(keyring, orgId, secret);

      expect(encrypted.length).toBeGreaterThan(0);
      expect(keyVersion).toBe(keyring.currentVersion);

      const decrypted = await decryptSecret(keyring, orgId, keyVersion, encrypted);

      expect(decrypted).toBe(secret);
    });

    test("different orgIds produce different ciphertexts", async () => {
      const keyring = makeTestKeyring();

      const result1 = await encryptSecret(keyring, "org-one", "password");
      const result2 = await encryptSecret(keyring, "org-two", "password");

      expect(result1.encrypted).not.toBe(result2.encrypted);
    });
  });

  describe("key rotation", () => {
    test("data encrypted with v1 can be decrypted after v2 is added", async () => {
      const secret1 = crypto.getRandomValues(new Uint8Array(32));
      const keyringV1: Keyring = { secrets: { 1: secret1 }, currentVersion: 1 };
      const orgId = "org-rotation";

      const { encrypted, keyVersion } = await encryptSecret(keyringV1, orgId, "rotated-secret");

      expect(keyVersion).toBe(1);

      const secret2 = crypto.getRandomValues(new Uint8Array(32));
      const keyringV2: Keyring = { secrets: { 1: secret1, 2: secret2 }, currentVersion: 2 };

      const decrypted = await decryptSecret(keyringV2, orgId, keyVersion, encrypted);

      expect(decrypted).toBe("rotated-secret");
    });

    test("envelope encrypted with v1 decrypts after v2 is added", async () => {
      const secret1 = crypto.getRandomValues(new Uint8Array(32));
      const keyringV1: Keyring = { secrets: { 1: secret1 }, currentVersion: 1 };
      const orgId = "org-envelope-rotation";
      const plaintext = new TextEncoder().encode("rotated blob");

      const result = await envelopeEncrypt(keyringV1, orgId, plaintext);

      expect(result.keyVersion).toBe(1);

      const secret2 = crypto.getRandomValues(new Uint8Array(32));
      const keyringV2: Keyring = { secrets: { 1: secret1, 2: secret2 }, currentVersion: 2 };

      const decrypted = await envelopeDecrypt(
        keyringV2,
        orgId,
        result.keyVersion,
        result.encryptedDek,
        result.encryptedBlob,
      );

      expect(new TextDecoder().decode(decrypted)).toBe("rotated blob");
    });
  });

  describe("base64", () => {
    test("toBase64 and fromBase64 round-trip", () => {
      const data = crypto.getRandomValues(new Uint8Array(64));
      const encoded = toBase64(data);
      const decoded = fromBase64(encoded);

      expect(decoded).toEqual(data);
    });
  });
});
