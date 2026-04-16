import { Context, Effect, Layer } from "effect";

import {
  cryptoError,
  decryptAesGcm,
  deriveKEK,
  encryptAesGcm,
  generateDEK,
  getSecret,
  importDekKey,
  resolveKeyring,
} from "../domain/credential-vault";
import { fromBase64, toBase64 } from "../lib/base64";
import { cloudflareEnv } from "./context";

import type {
  CredentialVaultCryptoError,
  CredentialVaultError,
  CredentialVaultKeyNotFoundError,
  EnvelopeEncryptResult,
  Keyring,
} from "../domain/credential-vault";

// -- Effect orchestrators over low-level crypto ----------------------------

const envelopeEncrypt = (
  keyring: Keyring,
  orgId: string,
  plaintext: Uint8Array,
): Effect.Effect<
  EnvelopeEncryptResult,
  CredentialVaultKeyNotFoundError | CredentialVaultCryptoError
> =>
  Effect.gen(function* () {
    const dek = generateDEK();
    const secret = yield* getSecret(keyring, keyring.currentVersion);
    const kek = yield* Effect.tryPromise({
      try: async () => deriveKEK(secret, orgId, keyring.currentVersion),
      catch: (cause) => cryptoError("derive KEK", cause),
    });
    const dekKey = yield* Effect.tryPromise({
      try: async () => importDekKey(dek, ["encrypt", "decrypt"]),
      catch: (cause) => cryptoError("import DEK", cause),
    });
    const encryptedBlob = yield* Effect.tryPromise({
      try: async () => encryptAesGcm(dekKey, plaintext),
      catch: (cause) => cryptoError("encrypt blob", cause),
    });
    const encryptedDek = yield* Effect.tryPromise({
      try: async () => encryptAesGcm(kek, dek),
      catch: (cause) => cryptoError("encrypt DEK", cause),
    });
    return {
      encryptedBlob,
      encryptedDek: toBase64(encryptedDek),
      keyVersion: keyring.currentVersion,
    };
  });

const envelopeDecrypt = (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedDekB64: string,
  encryptedBlob: Uint8Array,
): Effect.Effect<Uint8Array, CredentialVaultKeyNotFoundError | CredentialVaultCryptoError> =>
  Effect.gen(function* () {
    const secret = yield* getSecret(keyring, keyVersion);
    const kek = yield* Effect.tryPromise({
      try: async () => deriveKEK(secret, orgId, keyVersion),
      catch: (cause) => cryptoError("derive KEK", cause),
    });
    const dek = yield* Effect.tryPromise({
      try: async () => decryptAesGcm(kek, fromBase64(encryptedDekB64)),
      catch: (cause) => cryptoError("decrypt DEK", cause),
    });
    const dekKey = yield* Effect.tryPromise({
      try: async () => importDekKey(dek, ["decrypt"]),
      catch: (cause) => cryptoError("import DEK", cause),
    });
    return yield* Effect.tryPromise({
      try: async () => decryptAesGcm(dekKey, encryptedBlob),
      catch: (cause) => cryptoError("decrypt blob", cause),
    });
  });

const encryptSecretEffect = (
  keyring: Keyring,
  orgId: string,
  secret: string,
): Effect.Effect<
  { encrypted: string; keyVersion: number },
  CredentialVaultKeyNotFoundError | CredentialVaultCryptoError
> =>
  Effect.gen(function* () {
    const keySecret = yield* getSecret(keyring, keyring.currentVersion);
    const kek = yield* Effect.tryPromise({
      try: async () => deriveKEK(keySecret, orgId, keyring.currentVersion),
      catch: (cause) => cryptoError("derive KEK", cause),
    });
    const plaintext = new TextEncoder().encode(secret);
    const encrypted = yield* Effect.tryPromise({
      try: async () => encryptAesGcm(kek, plaintext),
      catch: (cause) => cryptoError("encrypt secret", cause),
    });
    return { encrypted: toBase64(encrypted), keyVersion: keyring.currentVersion };
  });

const decryptSecretEffect = (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedB64: string,
): Effect.Effect<string, CredentialVaultKeyNotFoundError | CredentialVaultCryptoError> =>
  Effect.gen(function* () {
    const secret = yield* getSecret(keyring, keyVersion);
    const kek = yield* Effect.tryPromise({
      try: async () => deriveKEK(secret, orgId, keyVersion),
      catch: (cause) => cryptoError("derive KEK", cause),
    });
    const decrypted = yield* Effect.tryPromise({
      try: async () => decryptAesGcm(kek, fromBase64(encryptedB64)),
      catch: (cause) => cryptoError("decrypt secret", cause),
    });
    return new TextDecoder().decode(decrypted);
  });

export { envelopeEncrypt, envelopeDecrypt, encryptSecretEffect, decryptSecretEffect };

// -- Service definition -----------------------------------------------------

export interface VaultService {
  readonly encryptSecret: (params: {
    readonly organizationId: string;
    readonly value: string;
  }) => Effect.Effect<
    { readonly encrypted: string; readonly keyVersion: number },
    CredentialVaultError
  >;
  readonly decryptSecret: (params: {
    readonly organizationId: string;
    readonly keyVersion: number;
    readonly encrypted: string;
  }) => Effect.Effect<string, CredentialVaultError>;
  readonly envelopeEncrypt: (params: {
    readonly organizationId: string;
    readonly plaintext: Uint8Array;
  }) => Effect.Effect<
    {
      readonly encryptedBlob: Uint8Array;
      readonly encryptedDek: string;
      readonly keyVersion: number;
    },
    CredentialVaultError
  >;
  readonly envelopeDecrypt: (params: {
    readonly organizationId: string;
    readonly keyVersion: number;
    readonly encryptedDek: string;
    readonly encryptedBlob: Uint8Array;
  }) => Effect.Effect<Uint8Array, CredentialVaultError>;
}

export class Vault extends Context.Tag("server/Vault")<Vault, VaultService>() {}

// Module-level keyring cache — env bindings are constant per worker isolate
// eslint-disable-next-line functional/no-let -- mutable cache for per-isolate keyring memoization
let keyringCache: { keyring: Keyring; source: string } | null = null;

const resolveConfiguredKeyring = Effect.gen(function* () {
  const env = yield* cloudflareEnv;
  if (keyringCache && keyringCache.source === env.VAULT_KEYRING) {
    return keyringCache.keyring;
  }
  const keyring = yield* resolveKeyring(env.VAULT_KEYRING);
  keyringCache = { keyring, source: env.VAULT_KEYRING };
  return keyring;
});

export const VaultLive = Layer.succeed(Vault, {
  encryptSecret: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* encryptSecretEffect(keyring, params.organizationId, params.value);
    }),

  decryptSecret: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* decryptSecretEffect(
        keyring,
        params.organizationId,
        params.keyVersion,
        params.encrypted,
      );
    }),

  envelopeEncrypt: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* envelopeEncrypt(keyring, params.organizationId, params.plaintext);
    }),

  envelopeDecrypt: (params) =>
    Effect.gen(function* () {
      const keyring = yield* resolveConfiguredKeyring;
      return yield* envelopeDecrypt(
        keyring,
        params.organizationId,
        params.keyVersion,
        params.encryptedDek,
        params.encryptedBlob,
      );
    }),
});
