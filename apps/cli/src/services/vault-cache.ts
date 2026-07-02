import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { fromBase64, toBase64 } from "@better-update/encoding";
import { safeJsonParse } from "@better-update/safe-json";
import { isRecord } from "@better-update/type-guards";
import { Entry } from "@napi-rs/keyring";
import { Clock, Context, Effect, Layer } from "effect";

import type { VaultKind } from "@better-update/credentials-crypto";

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

const execFileAsync = promisify(execFile);

/** Default for how long a cached vault key stays valid before a fresh passphrase is required. */
export const VAULT_CACHE_TTL_MS = 15 * 60 * 1000;

/** Bounds for a user-chosen TTL (`credentials unlock --duration`). */
export const VAULT_CACHE_TTL_MIN_MS = 60 * 1000;
export const VAULT_CACHE_TTL_MAX_MS = 24 * 60 * 60 * 1000;

/** Keychain service name; the account is the recipient's public key (per {@link cacheAccount}). */
const KEYCHAIN_SERVICE = "better-update-vault";

/**
 * The keychain account a recipient's cached key is stored under, namespaced by
 * vault kind so the credentials and env vaults cache independently. The
 * credentials vault keeps the bare public key — byte-identical to entries written
 * before the two-vault split, so an upgrade keeps any live unlock — while the env
 * vault is prefixed.
 */
const cacheAccount = (publicKey: string, vaultKind: VaultKind = "credentials"): string =>
  vaultKind === "env" ? `env:${publicKey}` : publicKey;

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
    /** The cached vault key for this recipient + vault kind, or `undefined` if absent/expired/disabled. */
    readonly get: (
      publicKey: string,
      vaultKind?: VaultKind,
    ) => Effect.Effect<CachedVault | undefined>;
    /** Stow the unlocked vault key under this recipient + vault kind, with a fresh TTL (default 15 min). */
    readonly set: (
      publicKey: string,
      vault: UnlockedVault,
      opts?: { readonly ttlMs?: number | undefined; readonly vaultKind?: VaultKind },
    ) => Effect.Effect<void>;
    /** Forget the cached vault key for this recipient + vault kind (the `lock` operation). */
    readonly clear: (publicKey: string, vaultKind?: VaultKind) => Effect.Effect<void>;
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
    const readRaw = (account: string) =>
      Effect.try(() => new Entry(KEYCHAIN_SERVICE, account).getPassword()).pipe(
        Effect.orElseSucceed((): string | null => null),
      );
    const deleteRaw = (account: string) =>
      Effect.try(() => new Entry(KEYCHAIN_SERVICE, account).deletePassword()).pipe(Effect.ignore);
    // The macOS keychain can hold an entry whose ACL is bound to a since-replaced
    // binary (e.g. a node upgrade): the keyring API then can't read, update, or
    // even delete it — only SecItemAdd still collides, failing every write with
    // errSecDuplicateItem. The `security` CLI goes through the legacy keychain
    // API and can still find and delete such an item.
    const evictStale = (account: string) =>
      Effect.zipRight(
        deleteRaw(account),
        process.platform === "darwin"
          ? Effect.tryPromise(async () =>
              execFileAsync("security", [
                "delete-generic-password",
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                account,
              ]),
            ).pipe(Effect.ignore)
          : Effect.void,
      );
    const writeRaw = (account: string, blob: string) => {
      const write = Effect.try(() => {
        new Entry(KEYCHAIN_SERVICE, account).setPassword(blob);
      });
      return write.pipe(
        Effect.orElse(() => Effect.zipRight(evictStale(account), write)),
        Effect.ignore,
      );
    };

    return {
      get: (publicKey, vaultKind) =>
        Effect.gen(function* () {
          if (yield* cacheDisabled) {
            return undefined;
          }
          const account = cacheAccount(publicKey, vaultKind);
          const raw = yield* readRaw(account);
          if (raw === null) {
            return undefined;
          }
          const now = yield* Clock.currentTimeMillis;
          const decoded = decodeCacheEntry(raw, now);
          if (decoded === undefined) {
            // Malformed or expired — evict so the next read is a clean miss.
            yield* deleteRaw(account);
            return undefined;
          }
          return decoded;
        }),

      set: (publicKey, vault, opts) =>
        Effect.gen(function* () {
          if (yield* cacheDisabled) {
            return;
          }
          const now = yield* Clock.currentTimeMillis;
          yield* writeRaw(
            cacheAccount(publicKey, opts?.vaultKind),
            encodeCacheEntry(vault, now, opts?.ttlMs),
          );
        }),

      clear: (publicKey, vaultKind) => deleteRaw(cacheAccount(publicKey, vaultKind)),
    };
  }),
);
