import { Data, Effect } from "effect";

import { fromBase64, toBase64 } from "../lib/base64";

export interface Keyring {
  readonly secrets: Record<number, Uint8Array>;
  readonly currentVersion: number;
}

export interface EnvelopeEncryptResult {
  readonly encryptedBlob: Uint8Array;
  readonly encryptedDek: string;
  readonly keyVersion: number;
}

export class CredentialVaultConfigError extends Data.TaggedError("CredentialVaultConfigError")<{
  readonly message: string;
}> {}

export class CredentialVaultKeyNotFoundError extends Data.TaggedError(
  "CredentialVaultKeyNotFoundError",
)<{
  readonly version: number;
  readonly message: string;
}> {}

export class CredentialVaultCryptoError extends Data.TaggedError("CredentialVaultCryptoError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause: Error;
}> {}

export type CredentialVaultError =
  | CredentialVaultConfigError
  | CredentialVaultKeyNotFoundError
  | CredentialVaultCryptoError;

const asBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
};

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));
const configError = (message: string) => new CredentialVaultConfigError({ message });
const keyNotFoundError = (version: number) =>
  new CredentialVaultKeyNotFoundError({
    version,
    message: `Keyring version ${String(version)} not found`,
  });
const cryptoError = (operation: string, cause: unknown) =>
  new CredentialVaultCryptoError({
    operation,
    message: `Credential vault ${operation} failed`,
    cause: asError(cause),
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getSecret = (
  keyring: Keyring,
  version: number,
): Effect.Effect<Uint8Array, CredentialVaultKeyNotFoundError> => {
  const secret = keyring.secrets[version];
  return secret ? Effect.succeed(secret) : Effect.fail(keyNotFoundError(version));
};

export const resolveKeyring = (
  vaultKeyringJson: string,
): Effect.Effect<Keyring, CredentialVaultConfigError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: () => JSON.parse(vaultKeyringJson) as unknown,
      catch: () => configError("Vault keyring must be valid JSON"),
    });
    if (!isRecord(raw)) {
      return yield* Effect.fail(configError("Vault keyring must be a JSON object"));
    }
    const entries = Object.entries(raw);
    if (entries.length === 0) {
      return yield* Effect.fail(configError("Vault keyring is empty"));
    }

    const pairs = yield* Effect.forEach(
      entries,
      ([key, value]) => {
        const version = Number(key);
        return Number.isInteger(version) && version >= 1
          ? Effect.try({
              try: () => [version, fromBase64(String(value))] as const,
              catch: () => configError(`Invalid keyring secret: ${key}`),
            })
          : Effect.fail(configError(`Invalid keyring version: ${key}`));
      },
      { concurrency: 1 },
    );

    const secrets: Record<number, Uint8Array> = Object.fromEntries(pairs);
    const currentVersion = Math.max(...Object.keys(secrets).map(Number));
    return { secrets, currentVersion };
  });

export const deriveKEK = async (
  secret: Uint8Array,
  orgId: string,
  keyVersion: number,
): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey("raw", asBuffer(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asBuffer(new TextEncoder().encode(orgId)),
      info: asBuffer(new TextEncoder().encode(`credential-vault:${keyVersion}`)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

export const generateDEK = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));

export const encryptAesGcm = async (key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(plaintext),
  );
  return new Uint8Array([...iv, ...new Uint8Array(encrypted)]);
};

export const decryptAesGcm = async (key: CryptoKey, data: Uint8Array): Promise<Uint8Array> => {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(ciphertext),
  );
  return new Uint8Array(decrypted);
};

const importDekKey = async (dek: Uint8Array, usages: readonly KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", asBuffer(dek), { name: "AES-GCM" }, true, [...usages]);

export const envelopeEncrypt = (
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

export const envelopeDecrypt = (
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

export const encryptSecret = (
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

export const decryptSecret = (
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
