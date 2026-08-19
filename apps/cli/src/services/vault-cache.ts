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

/** Keychain service name; the account encodes org + recipient (per {@link cacheAccount}). */
const KEYCHAIN_SERVICE = "better-update-vault";

/** Which vault key to cache, and whose: one entry per (org, recipient, vault kind). */
export interface VaultCacheKey {
  /** The org whose vault key this is. A device key is user-scoped and shared across orgs; the VAULT KEY is not. */
  readonly orgId: string;
  readonly publicKey: string;
  readonly vaultKind?: VaultKind | undefined;
}

/**
 * The keychain account a cached vault key is stored under: org + recipient,
 * namespaced by vault kind so the credentials and env vaults cache independently.
 *
 * The org is in the key because a `device` recipient is USER-scoped (one age key
 * per machine, shared by every org the user belongs to) while `org_vault_key_wraps`
 * is per-org — so one public key maps to N different vault keys. Keying on the
 * public key alone let org A's key answer a lookup made while org B was active,
 * which fails to unwrap on read and, worse, seals uploads under a key nobody in
 * org B holds (the server compares only the version NUMBER, so a cross-org seal at
 * a matching version is accepted and undecryptable forever).
 *
 * Entries written before the org was in the key sit at a different account name
 * and are simply never read again; {@link legacyCacheAccount} evicts them.
 */
const cacheAccount = (key: VaultCacheKey): string =>
  `${key.vaultKind === "env" ? "env:" : ""}${key.orgId}:${key.publicKey}`;

/** Pre-org account name, kept only so a stale entry can be deleted rather than left holding a vault key. */
const legacyCacheAccount = (key: VaultCacheKey): string =>
  key.vaultKind === "env" ? `env:${key.publicKey}` : key.publicKey;

/** The on-disk (keychain) shape: base64 vault key + provenance + an absolute expiry. */
interface CachedVaultEntry {
  readonly orgId: string;
  readonly vaultKey: string;
  readonly vaultVersion: number;
  readonly keyId: string;
  readonly exp: number;
}

const isCachedVaultEntry = (value: unknown): value is CachedVaultEntry =>
  isRecord(value) &&
  typeof value["orgId"] === "string" &&
  typeof value["vaultKey"] === "string" &&
  typeof value["vaultVersion"] === "number" &&
  typeof value["keyId"] === "string" &&
  typeof value["exp"] === "number";

/** An unlocked vault recovered from cache, plus how long it has left to live. */
export interface CachedVault {
  readonly vault: UnlockedVault;
  readonly remainingMs: number;
}

/** Serialize an unlocked vault into a keychain blob, stamping the owning org and a TTL from `now`. */
export const encodeCacheEntry = (
  orgId: string,
  vault: UnlockedVault,
  now: number,
  ttlMs: number = VAULT_CACHE_TTL_MS,
): string =>
  JSON.stringify({
    orgId,
    vaultKey: toBase64(vault.vaultKey),
    vaultVersion: vault.vaultVersion,
    keyId: vault.keyId,
    exp: now + ttlMs,
  } satisfies CachedVaultEntry);

/**
 * Parse a keychain blob back into an unlocked vault, or `undefined` when it is
 * malformed, belongs to a different org, or has expired as of `now` — so any of
 * those reads exactly like a missing entry (and is evicted by the caller).
 *
 * The `orgId` check is deliberate belt-and-braces on top of the account name: it
 * makes "vault key from the wrong org" unrepresentable even if a call site
 * derives the account wrongly, and it makes every pre-org entry (no `orgId`
 * field) fail the shape guard rather than decode into a silently wrong key.
 */
export const decodeCacheEntry = (
  raw: string,
  now: number,
  orgId: string,
): CachedVault | undefined => {
  const parsed = safeJsonParse(raw);
  if (!isCachedVaultEntry(parsed) || parsed.orgId !== orgId || now >= parsed.exp) {
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

export class VaultCache extends Context.Service<
  VaultCache,
  {
    /** The cached vault key for this org + recipient + vault kind, or `undefined` if absent/expired/disabled. */
    readonly get: (key: VaultCacheKey) => Effect.Effect<CachedVault | undefined>;
    /** Stow the unlocked vault key under this org + recipient + vault kind, with a fresh TTL (default 15 min). */
    readonly set: (
      key: VaultCacheKey,
      vault: UnlockedVault,
      opts?: { readonly ttlMs?: number | undefined },
    ) => Effect.Effect<void>;
    /** Forget the cached vault key for this org + recipient + vault kind (the `lock` operation). */
    readonly clear: (key: VaultCacheKey) => Effect.Effect<void>;
  }
>()("cli/VaultCache") {}

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
      Effect.andThen(
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
        Effect.catch(() => Effect.andThen(evictStale(account), write)),
        Effect.ignore,
      );
    };

    return {
      get: (key) =>
        Effect.gen(function* () {
          if (yield* cacheDisabled) {
            return undefined;
          }
          const account = cacheAccount(key);
          const raw = yield* readRaw(account);
          if (raw === null) {
            return undefined;
          }
          const now = yield* Clock.currentTimeMillis;
          const decoded = decodeCacheEntry(raw, now, key.orgId);
          if (decoded === undefined) {
            // Malformed, expired, or another org's — evict so the next read is a clean miss.
            yield* deleteRaw(account);
            return undefined;
          }
          return decoded;
        }),

      set: (key, vault, opts) =>
        Effect.gen(function* () {
          if (yield* cacheDisabled) {
            return;
          }
          const now = yield* Clock.currentTimeMillis;
          // Drop any pre-org entry for this recipient on the way past: nothing
          // reads it anymore, so left alone it would keep a real vault key at
          // rest in the keychain forever. Plain delete rather than `evictStale`
          // — this runs on every unlock, and the `security` fallback is a
          // subprocess; `clear` is where thoroughness matters.
          yield* deleteRaw(legacyCacheAccount(key));
          yield* writeRaw(cacheAccount(key), encodeCacheEntry(key.orgId, vault, now, opts?.ttlMs));
        }),

      // `lock` must actually lock, so this uses the same `security`-CLI fallback
      // as writes: a keychain item whose ACL is bound to a since-replaced binary
      // cannot be deleted through the keyring API, and a plain best-effort delete
      // would report success while leaving the key readable to the next command.
      clear: (key) =>
        Effect.andThen(evictStale(cacheAccount(key)), evictStale(legacyCacheAccount(key))),
    };
  }),
);
