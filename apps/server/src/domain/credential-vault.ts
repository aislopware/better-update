import { Data, Effect } from "effect";

import { fromBase64 } from "../lib/base64";
import { isRecord } from "../lib/type-guards";

// -- Types ------------------------------------------------------------------

export interface Keyring {
  readonly secrets: Record<number, Uint8Array>;
  readonly currentVersion: number;
}

export interface EnvelopeEncryptResult {
  readonly encryptedBlob: Uint8Array;
  readonly encryptedDek: string;
  readonly keyVersion: number;
}

// -- Errors -----------------------------------------------------------------

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

// -- Helpers ----------------------------------------------------------------

export const asBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  return copy;
};

export const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));
const configError = (message: string) => new CredentialVaultConfigError({ message });
const keyNotFoundError = (version: number) =>
  new CredentialVaultKeyNotFoundError({
    version,
    message: `Keyring version ${String(version)} not found`,
  });
export const cryptoError = (operation: string, cause: unknown) =>
  new CredentialVaultCryptoError({
    operation,
    message: `Credential vault ${operation} failed`,
    cause: asError(cause),
  });

export const getSecret = (
  keyring: Keyring,
  version: number,
): Effect.Effect<Uint8Array, CredentialVaultKeyNotFoundError> => {
  const secret = keyring.secrets[version];
  return secret ? Effect.succeed(secret) : Effect.fail(keyNotFoundError(version));
};

// -- Keyring parsing --------------------------------------------------------

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

// -- Low-level crypto primitives -------------------------------------------

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

export const importDekKey = async (
  dek: Uint8Array,
  usages: readonly KeyUsage[],
): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", asBuffer(dek), { name: "AES-GCM" }, true, [...usages]);
