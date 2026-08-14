import { openIdentity, unwrapVaultKey, wrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";
import type { IdentityFile } from "@better-update/credentials-crypto";

import { IdentityError } from "../lib/exit-codes";
import { promptPassword } from "../lib/prompts";
import { DeviceUnlockMemo } from "../services/device-unlock-memo";
import { VaultCache, VaultCacheLive } from "../services/vault-cache";
import { activeEnvPrivateKey, activeRecipient, loadIdentityFileOrFail } from "./identity";

import type { InteractiveProhibitedError } from "../lib/exit-codes";
import type { InteractiveMode } from "../lib/interactive-mode";
import type { ApiClient } from "../services/api-client";
import type { CliRuntime } from "../services/cli-runtime";
import type { IdentityStore } from "../services/identity-store";

/** The org vault key unlocked locally, tagged with the version + recipient it came from. */
export interface UnlockedVault {
  readonly vaultKey: Uint8Array;
  readonly vaultVersion: number;
  readonly keyId: string;
}

/** This device's on-disk identity, opened: the age private key plus the passphrase that opened it. */
export interface UnlockedDeviceIdentity {
  readonly privateKey: string;
  readonly passphrase: string;
}

/**
 * Open a sealed identity envelope. `openIdentity` re-derives — and the seal
 * authenticates — the public key, so a wrong passphrase and a tampered file both
 * land on the same guidance here.
 */
const openIdentityFile = (file: IdentityFile, passphrase: string) =>
  Effect.tryPromise({
    try: async () => openIdentity({ file, passphrase }),
    catch: () =>
      new IdentityError({
        message:
          "Could not unlock this device's identity — wrong passphrase, or the identity file was altered.",
      }),
  });

/**
 * Resolve this device's age private key. A CI robot's env-sourced key (from
 * `BETTER_UPDATE_ROBOT`, or the deprecated standalone `BETTER_UPDATE_IDENTITY`)
 * is used raw (no passphrase); otherwise the on-disk envelope is opened with the
 * supplied passphrase.
 */
export const unlockActivePrivateKey = (
  passphrase: string | undefined,
): Effect.Effect<string, IdentityError, CliRuntime | IdentityStore> =>
  Effect.gen(function* () {
    const envKey = yield* activeEnvPrivateKey;
    if (envKey !== undefined && envKey.length > 0) {
      return envKey;
    }
    const file = yield* loadIdentityFileOrFail;
    if (passphrase === undefined) {
      return yield* new IdentityError({
        message: "A passphrase is required to unlock ~/.better-update/identity.json.",
      });
    }
    const identity = yield* openIdentityFile(file, passphrase);
    return identity.privateKey;
  });

/**
 * Open this device's on-disk identity for an interactive command, prompting for
 * the passphrase at most ONCE per process ({@link DeviceUnlockMemo}). Every
 * interactive vault unlock funnels through here, so a command that touches both
 * org vaults — `credentials access grant`, a build resolving credentials and env
 * values — asks a single time instead of once per vault. The memo is only
 * written after `openIdentity` succeeds, so a typo is never remembered.
 *
 * Callers that must act as the ACTIVE identity (robot env key included) go
 * through {@link unlockVaultKeyInteractive} instead; this one is on-disk only,
 * because the passphrase it returns is what seals a per-user account key.
 *
 * `message` tailors the prompt for callers that want to say what the passphrase
 * is about to be used for; it is naturally unused on a memo hit, where there is
 * no prompt to word.
 */
export const unlockDeviceIdentityInteractive = (
  message = "Passphrase to unlock this device's identity:",
): Effect.Effect<
  UnlockedDeviceIdentity,
  IdentityError | InteractiveProhibitedError,
  DeviceUnlockMemo | IdentityStore | InteractiveMode
> =>
  Effect.gen(function* () {
    const file = yield* loadIdentityFileOrFail;
    const memo = yield* DeviceUnlockMemo;
    const remembered = yield* memo.get(file.publicKey);
    if (remembered !== undefined) {
      return remembered;
    }
    const passphrase = yield* promptPassword(message);
    const identity = yield* openIdentityFile(file, passphrase);
    return yield* memo.set(file.publicKey, { privateKey: identity.privateKey, passphrase });
  });

/**
 * Actionable guidance for a device that can't reach the vault, branched on
 * whether the org vault exists yet. A fresh org has no vault — the first member
 * runs `credentials identity init` (which also mints the offline recovery key);
 * an existing vault means this device simply isn't a recipient, so it needs an
 * admin grant or a self-link from a device that already has it. Exported so the
 * post-`identity create` hint stays in sync with this error path.
 */
export const VAULT_NOT_RECIPIENT_GUIDANCE =
  "This device isn't a vault recipient yet. Ask an org admin to run `better-update credentials access grant`, or self-link from a device that already has access with `better-update credentials device link`.";

export const VAULT_NOT_SET_UP_GUIDANCE =
  "This organization's credential vault isn't set up yet. Run `better-update credentials identity init` to bootstrap it — you'll get a one-time offline recovery key to store safely.";

/** `true` if the org vault has been bootstrapped; `false` on `NotFound` (a fresh org). */
export const orgVaultExists = (api: ApiClient) =>
  api.orgVault.get().pipe(
    Effect.as(true),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );

const vaultAccessError = (api: ApiClient) =>
  Effect.gen(function* () {
    const exists = yield* orgVaultExists(api);
    return yield* new IdentityError({
      message: exists ? VAULT_NOT_RECIPIENT_GUIDANCE : VAULT_NOT_SET_UP_GUIDANCE,
    });
  });

/**
 * Unlock the org vault key from an ALREADY-resolved private key: find this
 * device's recipient row, fetch its wrap, and unwrap it. A missing wrap is
 * resolved by {@link vaultAccessError} into init-vs-grant guidance; an unwrap
 * failure means access was revoked or rotated. Split out from
 * {@link unlockVaultKey} so the interactive path can feed it a private key the
 * device unlocked once for the whole run.
 */
const unlockVaultKeyWith = (api: ApiClient, privateKey: string) =>
  Effect.gen(function* () {
    const recipient = yield* activeRecipient;
    const { items } = yield* api.userEncryptionKeys.list();
    const own = items.find((key) => key.publicKey === recipient.publicKey);
    if (!own) {
      return yield* new IdentityError({
        message:
          "This device's encryption key is not registered. Run `better-update credentials identity register`, then have an admin grant it vault access.",
      });
    }
    const wrap = yield* api.orgVault
      .getWrap({ path: { keyId: own.id } })
      .pipe(Effect.catchTag("NotFound", () => vaultAccessError(api)));
    const vaultKey = yield* Effect.tryPromise({
      try: async () => unwrapVaultKey({ wrapped: fromBase64(wrap.wrappedKey), privateKey }),
      catch: () =>
        new IdentityError({
          message:
            "This device could not unwrap the vault key — its access may have been revoked or rotated. Ask an admin to re-grant access.",
        }),
    });
    return { vaultKey, vaultVersion: wrap.vaultVersion, keyId: own.id } satisfies UnlockedVault;
  });

/**
 * Unlock the org vault key for this device, resolving the private key from the
 * env (CI robot) or from the on-disk identity + `passphrase` first.
 */
export const unlockVaultKey = (api: ApiClient, passphrase: string | undefined) =>
  unlockActivePrivateKey(passphrase).pipe(
    Effect.flatMap((privateKey) => unlockVaultKeyWith(api, privateKey)),
  );

/**
 * Wrap the (already-unlocked) vault key to another recipient and push the wrap
 * row at the version it was unlocked from — the server CAS-rejects it if the
 * vault rotated underneath. Serves both admin grants and self-linking a device.
 */
export const grantRecipient = (args: {
  readonly api: ApiClient;
  readonly vault: UnlockedVault;
  readonly target: UserEncryptionKey;
}) =>
  Effect.gen(function* () {
    const wrapped = yield* Effect.promise(async () =>
      wrapVaultKey({ vaultKey: args.vault.vaultKey, recipient: args.target.publicKey }),
    );
    return yield* args.api.orgVault.addWrap({
      payload: {
        vaultVersion: args.vault.vaultVersion,
        wrap: { userEncryptionKeyId: args.target.id, wrappedKey: toBase64(wrapped) },
      },
    });
  });

/**
 * Unlock the org vault key for an interactive command, reusing a cached vault key
 * from the OS keychain when one is present and unexpired — so the device
 * passphrase is prompted at most once per cache TTL rather than on every command
 * (`better-update credentials unlock` / `lock` drive that session explicitly).
 * A CI robot's env-sourced key carries no passphrase and is never cached: it
 * skips straight to the raw unwrap. On a cache miss the full unlock runs —
 * prompt, Argon2id, fetch + unwrap — and the result is cached for next time.
 * The prompt itself goes through {@link unlockDeviceIdentityInteractive}, so a
 * miss here still costs no prompt if this run already opened the identity for
 * another vault.
 *
 * The cached key is the unwrapped vault key, which both unwraps (decrypt/read)
 * and wraps (encrypt/write) DEKs — so this single entry point backs every vault
 * operation: download/build-resolve reads, seal-for-upload + generate writes, and
 * rotation. There is no read-only cache: an unlock makes the next write seamless
 * too.
 *
 * `cacheTtlMs` overrides how long the unlocked key stays cached (default 15 min)
 * — `credentials unlock --duration` is the one caller that sets it.
 */
export const unlockVaultKeyInteractive = (
  api: ApiClient,
  options: { readonly orgId: string; readonly cacheTtlMs?: number | undefined },
) =>
  Effect.gen(function* () {
    const recipient = yield* activeRecipient;
    if (recipient.source !== "file") {
      return yield* unlockVaultKey(api, undefined);
    }
    const cache = yield* VaultCache;
    const cached = yield* cache.get({ orgId: options.orgId, publicKey: recipient.publicKey });
    if (cached !== undefined) {
      return cached.vault;
    }
    const { privateKey } = yield* unlockDeviceIdentityInteractive();
    const vault = yield* unlockVaultKeyWith(api, privateKey);
    yield* cache.set({ orgId: options.orgId, publicKey: recipient.publicKey }, vault, {
      ttlMs: options.cacheTtlMs,
    });
    return vault;
    // Discharge `VaultCache` here — it only needs `CliRuntime` (already in scope),
    // so the cache stays an internal detail and never widens the requirements of
    // the publish / download / credential flows that call this.
  }).pipe(Effect.provide(VaultCacheLive));

/**
 * Forget this device's cached vault key for `orgId`. Called after a rotation
 * re-keys the vault: the cached key + version are now stale, so leaving them
 * would make the next seal upload a key/version the server CAS-rejects (and the
 * next decrypt fail integrity). Clearing forces a fresh unlock at the new version
 * next time — which also correctly locks out a device that just revoked its own
 * access.
 *
 * `orgId` is explicit rather than "whatever org is active now" because the caller
 * that matters most — `org switch` — runs this AFTER the switch has landed, and
 * must clear the org it LEFT.
 */
export const forgetCachedVaultKey = (
  orgId: string,
): Effect.Effect<void, IdentityError, CliRuntime | IdentityStore> =>
  Effect.gen(function* () {
    const recipient = yield* activeRecipient;
    const cache = yield* VaultCache;
    yield* cache.clear({ orgId, publicKey: recipient.publicKey });
  }).pipe(Effect.provide(VaultCacheLive));

/** Look up a registered recipient by its key id or full `SHA256:` fingerprint. */
export const findRecipient = (api: ApiClient, selector: string) =>
  Effect.gen(function* () {
    const { items } = yield* api.userEncryptionKeys.list();
    const match = items.find((key) => key.id === selector || key.fingerprint === selector);
    if (match === undefined) {
      return yield* new IdentityError({
        message: `No registered encryption key matches "${selector}". Pass a key id or full fingerprint — see \`better-update credentials access list\`.`,
      });
    }
    return match;
  });
