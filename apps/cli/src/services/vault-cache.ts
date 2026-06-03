import { fromBase64, toBase64 } from "@better-update/encoding";
import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { Entry } from "@napi-rs/keyring";
import { Clock, Context, Effect, Layer } from "effect";

import { CliRuntime } from "./cli-runtime";

import type { UnlockedVault } from "../application/vault-access";

/**
 * "Unlock once, reuse" for the credential vault — the analog of macOS
 * `security unlock-keychain`. The first vault operation in a session prompts for
 * the device passphrase, unwraps the vault key, and stows it in the OS keychain
 * (`@napi-rs/keyring`: macOS Keychain / Windows Credential Manager / Linux
 * libsecret) with a short TTL; subsequent commands read it back and skip the
 * prompt + Argon2id derivation entirely until it expires.
 *
 * What is cached is the unwrapped **vault key**, never the passphrase or the age
 * private key — so the blast radius of a leaked keychain entry is one vault
 * version's credentials, and only until the TTL lapses.
 */

/** How long a cached vault key stays valid before a fresh passphrase is required. */
export const VAULT_CACHE_TTL_MS = 15 * 60 * 1000;

/** Keychain service name; the account is the recipient's public key. */
const KEYCHAIN_SERVICE = "better-update-vault";

/** The on-disk (keychain) shape: base64 vault key + provenance + an absolute expiry. */
interface CachedVaultEntry {
  readonly vaultKey: string;
  readonly vaultVersion: number;
  readonly keyId: string;
  readonly exp: number;
}

const isCachedVaultEntry = (value: unknown): value is CachedVaultEntry =>
  isRecord(value) &&
  typeof value["vaultKey"] === "string" &&
  typeof value["vaultVersion"] === "number" &&
  typeof value["keyId"] === "string" &&
  typeof value["exp"] === "number";

/** An unlocked vault recovered from cache, plus how long it has left to live. */
export interface CachedVault {
  readonly vault: UnlockedVault;
  readonly remainingMs: number;
}

/** Serialize an unlocked vault into a keychain blob, stamping a TTL from `now`. */
export const encodeCacheEntry = (
  vault: UnlockedVault,
  now: number,
  ttlMs: number = VAULT_CACHE_TTL_MS,
): string =>
  JSON.stringify({
    vaultKey: toBase64(vault.vaultKey),
    vaultVersion: vault.vaultVersion,
    keyId: vault.keyId,
    exp: now + ttlMs,
  } satisfies CachedVaultEntry);

/**
 * Parse a keychain blob back into an unlocked vault, or `undefined` when it is
 * malformed or has expired as of `now` — so an expired entry reads exactly like
 * a missing one (and is evicted by the caller).
 */
export const decodeCacheEntry = (raw: string, now: number): CachedVault | undefined => {
  const parsed = safeJsonParse(raw);
  if (!isCachedVaultEntry(parsed) || now >= parsed.exp) {
    return undefined;
  }
  return {
    vault: {
      vaultKey: fromBase64(parsed.vaultKey),
      vaultVersion: parsed.vaultVersion,
      keyId: parsed.keyId,
    },
    remainingMs: parsed.exp - now,
  };
};

export class VaultCache extends Context.Tag("cli/VaultCache")<
  VaultCache,
  {
    /** The cached vault key for this recipient, or `undefined` if absent/expired/disabled. */
    readonly get: (publicKey: string) => Effect.Effect<CachedVault | undefined>;
    /** Stow the unlocked vault key under this recipient, with a fresh TTL. */
    readonly set: (publicKey: string, vault: UnlockedVault) => Effect.Effect<void>;
    /** Forget the cached vault key for this recipient (the `lock` operation). */
    readonly clear: (publicKey: string) => Effect.Effect<void>;
  }
>() {}

export const VaultCacheLive = Layer.effect(
  VaultCache,
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;

    // `BETTER_UPDATE_NO_CACHE=1` (or any truthy value) opts out: every vault
    // operation prompts, nothing is read from or written to the keychain.
    const cacheDisabled = Effect.gen(function* () {
      const flag = yield* runtime.getEnv("BETTER_UPDATE_NO_CACHE");
      return flag !== undefined && flag.length > 0 && flag !== "0" && flag !== "false";
    });

    // All keyring access is best-effort. A machine with no usable OS keychain
    // (headless Linux without libsecret, a locked login keychain, …) must degrade
    // to "no cache" — prompt every time — rather than crash a command.
    const readRaw = (publicKey: string) =>
      Effect.try(() => new Entry(KEYCHAIN_SERVICE, publicKey).getPassword()).pipe(
        Effect.orElseSucceed((): string | null => null),
      );
    const writeRaw = (publicKey: string, blob: string) =>
      Effect.try(() => {
        new Entry(KEYCHAIN_SERVICE, publicKey).setPassword(blob);
      }).pipe(Effect.ignore);
    const deleteRaw = (publicKey: string) =>
      Effect.try(() => new Entry(KEYCHAIN_SERVICE, publicKey).deletePassword()).pipe(Effect.ignore);

    return {
      get: (publicKey) =>
        Effect.gen(function* () {
          if (yield* cacheDisabled) {
            return undefined;
          }
          const raw = yield* readRaw(publicKey);
          if (raw === null) {
            return undefined;
          }
          const now = yield* Clock.currentTimeMillis;
          const decoded = decodeCacheEntry(raw, now);
          if (decoded === undefined) {
            // Malformed or expired — evict so the next read is a clean miss.
            yield* deleteRaw(publicKey);
            return undefined;
          }
          return decoded;
        }),

      set: (publicKey, vault) =>
        Effect.gen(function* () {
          if (yield* cacheDisabled) {
            return;
          }
          const now = yield* Clock.currentTimeMillis;
          yield* writeRaw(publicKey, encodeCacheEntry(vault, now));
        }),

      clear: (publicKey) => deleteRaw(publicKey),
    };
  }),
);
