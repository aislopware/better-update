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

const asError = (cause: unknown): Error =>
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

// -- Sync primitives (no I/O) ----------------------------------------------

export const generateDEK = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32));
