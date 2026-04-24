import { fromBase64, toBase64 } from "@better-update/encoding";
import { Context, Effect, Layer } from "effect";

import { cryptoError, generateDEK, getSecret, resolveKeyring } from "../domain/credential-vault";
import { CryptoService } from "../domain/crypto-service";
import { cloudflareEnv } from "./context";

import type {
  CredentialVaultCryptoError,
  CredentialVaultError,
  CredentialVaultKeyNotFoundError,
  EnvelopeEncryptResult,
  Keyring,
} from "../domain/credential-vault";
import type { CryptoError } from "../domain/crypto-service";

// -- Error mapping ---------------------------------------------------------

const toVaultCryptoError =
  (operation: string) =>
  (error: CryptoError): CredentialVaultCryptoError =>
    cryptoError(operation, error.cause);

const decodeBase64 = (operation: string, value: string) =>
  Effect.try({
    try: () => fromBase64(value),
    catch: (cause) => cryptoError(operation, cause),
  });

// -- Effect orchestrators over CryptoService -------------------------------

const envelopeEncrypt = (
  keyring: Keyring,
  orgId: string,
  plaintext: Uint8Array,
): Effect.Effect<
  EnvelopeEncryptResult,
  CredentialVaultKeyNotFoundError | CredentialVaultCryptoError,
  CryptoService
> =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const dek = generateDEK();
    const secret = yield* getSecret(keyring, keyring.currentVersion);
    const kek = yield* service
      .deriveKek(secret, orgId, keyring.currentVersion)
      .pipe(Effect.mapError(toVaultCryptoError("derive KEK")));
    const dekKey = yield* service
      .importDekKey(dek, ["encrypt", "decrypt"])
      .pipe(Effect.mapError(toVaultCryptoError("import DEK")));
    const encryptedBlob = yield* service
      .encryptAesGcm(dekKey, plaintext)
      .pipe(Effect.mapError(toVaultCryptoError("encrypt blob")));
    const encryptedDek = yield* service
      .encryptAesGcm(kek, dek)
      .pipe(Effect.mapError(toVaultCryptoError("encrypt DEK")));
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
): Effect.Effect<
  Uint8Array,
  CredentialVaultKeyNotFoundError | CredentialVaultCryptoError,
  CryptoService
> =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const secret = yield* getSecret(keyring, keyVersion);
    const kek = yield* service
      .deriveKek(secret, orgId, keyVersion)
      .pipe(Effect.mapError(toVaultCryptoError("derive KEK")));
    const encryptedDek = yield* decodeBase64("decode encrypted DEK", encryptedDekB64);
    const dek = yield* service
      .decryptAesGcm(kek, encryptedDek)
      .pipe(Effect.mapError(toVaultCryptoError("decrypt DEK")));
    const dekKey = yield* service
      .importDekKey(dek, ["decrypt"])
      .pipe(Effect.mapError(toVaultCryptoError("import DEK")));
    return yield* service
      .decryptAesGcm(dekKey, encryptedBlob)
      .pipe(Effect.mapError(toVaultCryptoError("decrypt blob")));
  });

const encryptSecretEffect = (
  keyring: Keyring,
  orgId: string,
  secret: string,
): Effect.Effect<
  { encrypted: string; keyVersion: number },
  CredentialVaultKeyNotFoundError | CredentialVaultCryptoError,
  CryptoService
> =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const keySecret = yield* getSecret(keyring, keyring.currentVersion);
    const kek = yield* service
      .deriveKek(keySecret, orgId, keyring.currentVersion)
      .pipe(Effect.mapError(toVaultCryptoError("derive KEK")));
    const plaintext = new TextEncoder().encode(secret);
    const encrypted = yield* service
      .encryptAesGcm(kek, plaintext)
      .pipe(Effect.mapError(toVaultCryptoError("encrypt secret")));
    return { encrypted: toBase64(encrypted), keyVersion: keyring.currentVersion };
  });

const decryptSecretEffect = (
  keyring: Keyring,
  orgId: string,
  keyVersion: number,
  encryptedB64: string,
): Effect.Effect<
  string,
  CredentialVaultKeyNotFoundError | CredentialVaultCryptoError,
  CryptoService
> =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const secret = yield* getSecret(keyring, keyVersion);
    const kek = yield* service
      .deriveKek(secret, orgId, keyVersion)
      .pipe(Effect.mapError(toVaultCryptoError("derive KEK")));
    const encrypted = yield* decodeBase64("decode encrypted secret", encryptedB64);
    const decrypted = yield* service
      .decryptAesGcm(kek, encrypted)
      .pipe(Effect.mapError(toVaultCryptoError("decrypt secret")));
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

// Module-level keyring cache — env bindings are constant per worker isolate.
// Cache keyed by the raw VAULT_KEYRING string so in-place rotations invalidate
// On next request. Rotating VAULT_KEYRING in prod requires a deploy to flush
// Live isolates; decoded DEKs otherwise stay in V8 heap for isolate lifetime.
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

export const VaultLive = Layer.effect(
  Vault,
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const provideCrypto = Effect.provideService(CryptoService, service);

    return {
      encryptSecret: (params) =>
        Effect.gen(function* () {
          const keyring = yield* resolveConfiguredKeyring;
          return yield* encryptSecretEffect(keyring, params.organizationId, params.value);
        }).pipe(provideCrypto),

      decryptSecret: (params) =>
        Effect.gen(function* () {
          const keyring = yield* resolveConfiguredKeyring;
          return yield* decryptSecretEffect(
            keyring,
            params.organizationId,
            params.keyVersion,
            params.encrypted,
          );
        }).pipe(provideCrypto),

      envelopeEncrypt: (params) =>
        Effect.gen(function* () {
          const keyring = yield* resolveConfiguredKeyring;
          return yield* envelopeEncrypt(keyring, params.organizationId, params.plaintext);
        }).pipe(provideCrypto),

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
        }).pipe(provideCrypto),
    };
  }),
);
