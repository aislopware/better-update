import { it } from "@effect/vitest";
import { Effect } from "effect";

import { CredentialVaultCryptoError } from "../domain/credential-vault";
import { fromBase64, toBase64 } from "../lib/base64";
import { CryptoServiceLive } from "./crypto-service";
import {
  decryptSecretEffect as decryptSecret,
  encryptSecretEffect as encryptSecret,
  envelopeDecrypt,
  envelopeEncrypt,
} from "./vault";

import type { Keyring } from "../domain/credential-vault";

const withCrypto = Effect.provide(CryptoServiceLive);

const makeTestKeyring = (): Keyring => {
  const secret1 = crypto.getRandomValues(new Uint8Array(32));
  const secret2 = crypto.getRandomValues(new Uint8Array(32));
  return {
    secrets: { 1: secret1, 2: secret2 },
    currentVersion: 2,
  };
};

describe("vault orchestrators", () => {
  describe("envelopeEncrypt / envelopeDecrypt", () => {
    it.effect("round-trips binary data", () =>
      Effect.gen(function* () {
        const keyring = makeTestKeyring();
        const orgId = "org-test-123";
        const plaintext = new TextEncoder().encode("secret file contents");

        const result = yield* envelopeEncrypt(keyring, orgId, plaintext);

        expect(result.keyVersion).toBe(keyring.currentVersion);
        expect(result.encryptedBlob.length).toBeGreaterThan(0);
        expect(result.encryptedDek.length).toBeGreaterThan(0);

        const decrypted = yield* envelopeDecrypt(
          keyring,
          orgId,
          result.keyVersion,
          result.encryptedDek,
          result.encryptedBlob,
        );

        expect(new TextDecoder().decode(decrypted)).toBe("secret file contents");
      }).pipe(withCrypto),
    );

    it.effect("different orgIds produce different ciphertexts", () =>
      Effect.gen(function* () {
        const keyring = makeTestKeyring();
        const plaintext = new TextEncoder().encode("same data");

        const result1 = yield* envelopeEncrypt(keyring, "org-alpha", plaintext);
        const result2 = yield* envelopeEncrypt(keyring, "org-beta", plaintext);

        expect(result1.encryptedDek).not.toBe(result2.encryptedDek);
      }).pipe(withCrypto),
    );

    it.effect("decryption fails with a tagged crypto error for wrong orgId", () =>
      Effect.gen(function* () {
        const keyring = makeTestKeyring();
        const plaintext = new TextEncoder().encode("secret");

        const result = yield* envelopeEncrypt(keyring, "org-correct", plaintext);

        const error = yield* Effect.flip(
          envelopeDecrypt(
            keyring,
            "org-wrong",
            result.keyVersion,
            result.encryptedDek,
            result.encryptedBlob,
          ),
        );

        expect(error).toBeInstanceOf(CredentialVaultCryptoError);
        expect(error._tag).toBe("CredentialVaultCryptoError");
        if (error._tag !== "CredentialVaultCryptoError") {
          throw new Error(`Unexpected error tag: ${error._tag}`);
        }
        expect(error.operation).toBe("decrypt DEK");
      }).pipe(withCrypto),
    );
  });

  describe("encryptSecret / decryptSecret", () => {
    it.effect("round-trips a string secret", () =>
      Effect.gen(function* () {
        const keyring = makeTestKeyring();
        const orgId = "org-test-456";
        const secret = "my-super-secret-password";

        const { encrypted, keyVersion } = yield* encryptSecret(keyring, orgId, secret);

        expect(encrypted.length).toBeGreaterThan(0);
        expect(keyVersion).toBe(keyring.currentVersion);

        const decrypted = yield* decryptSecret(keyring, orgId, keyVersion, encrypted);

        expect(decrypted).toBe(secret);
      }).pipe(withCrypto),
    );

    it.effect("different orgIds produce different ciphertexts", () =>
      Effect.gen(function* () {
        const keyring = makeTestKeyring();

        const result1 = yield* encryptSecret(keyring, "org-one", "password");
        const result2 = yield* encryptSecret(keyring, "org-two", "password");

        expect(result1.encrypted).not.toBe(result2.encrypted);
      }).pipe(withCrypto),
    );
  });

  describe("key rotation", () => {
    it.effect("data encrypted with v1 can be decrypted after v2 is added", () =>
      Effect.gen(function* () {
        const secret1 = crypto.getRandomValues(new Uint8Array(32));
        const keyringV1: Keyring = { secrets: { 1: secret1 }, currentVersion: 1 };
        const orgId = "org-rotation";

        const { encrypted, keyVersion } = yield* encryptSecret(keyringV1, orgId, "rotated-secret");

        expect(keyVersion).toBe(1);

        const secret2 = crypto.getRandomValues(new Uint8Array(32));
        const keyringV2: Keyring = { secrets: { 1: secret1, 2: secret2 }, currentVersion: 2 };

        const decrypted = yield* decryptSecret(keyringV2, orgId, keyVersion, encrypted);

        expect(decrypted).toBe("rotated-secret");
      }).pipe(withCrypto),
    );

    it.effect("envelope encrypted with v1 decrypts after v2 is added", () =>
      Effect.gen(function* () {
        const secret1 = crypto.getRandomValues(new Uint8Array(32));
        const keyringV1: Keyring = { secrets: { 1: secret1 }, currentVersion: 1 };
        const orgId = "org-envelope-rotation";
        const plaintext = new TextEncoder().encode("rotated blob");

        const result = yield* envelopeEncrypt(keyringV1, orgId, plaintext);

        expect(result.keyVersion).toBe(1);

        const secret2 = crypto.getRandomValues(new Uint8Array(32));
        const keyringV2: Keyring = { secrets: { 1: secret1, 2: secret2 }, currentVersion: 2 };

        const decrypted = yield* envelopeDecrypt(
          keyringV2,
          orgId,
          result.keyVersion,
          result.encryptedDek,
          result.encryptedBlob,
        );

        expect(new TextDecoder().decode(decrypted)).toBe("rotated blob");
      }).pipe(withCrypto),
    );
  });

  describe("base64 round-trip", () => {
    test("toBase64 and fromBase64 round-trip", () => {
      const data = crypto.getRandomValues(new Uint8Array(64));
      const encoded = toBase64(data);
      const decoded = fromBase64(encoded);

      expect(decoded).toEqual(data);
    });
  });
});
