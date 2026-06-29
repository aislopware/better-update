import { unwrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import { IdentityError } from "../lib/exit-codes";
import { promptPassword } from "../lib/prompts";
import { VaultCache, VaultCacheLive } from "../services/vault-cache";
import { getActiveOrgId, openVaultSessionInteractive } from "./credential-cipher";
import { activeRecipient, recipientKind } from "./identity";
import { unlockActivePrivateKey } from "./vault-access";

import type { ApiClient } from "../services/api-client";
import type { VaultSession } from "./credential-cipher";
import type { UnlockedVault } from "./vault-access";

/**
 * Guidance when this device holds no env-vault wrap. Post-cutover the env vault is
 * a SEPARATE key from the credentials vault, so even a device that can read
 * credentials may not be an env recipient yet — it self-links by enrolling an
 * account key, or an admin re-runs the env-vault migration / rotation to include
 * it.
 */
export const ENV_VAULT_NOT_RECIPIENT_GUIDANCE =
  "This device isn't an env-vault recipient. Run `better-update credentials account create` to enroll, or ask an admin to re-run `better-update credentials env-vault rotate` to include it.";

/**
 * Unlock the ENV-vault key for this device via its env wrap (post-cutover). The
 * env vault holds a DIFFERENT key from the credentials vault — wrapped to the same
 * device/recovery/machine recipients PLUS per-user account keys — so this mirrors
 * {@link unlockVaultKey} but reads the polymorphic `org_env_vault_key_wraps` row
 * keyed by this device's `(recipientKind, keyId)`.
 */
export const unlockEnvVaultKey = (api: ApiClient, passphrase: string | undefined) =>
  Effect.gen(function* () {
    const recipient = yield* activeRecipient;
    const privateKey = yield* unlockActivePrivateKey(passphrase);
    const { items } = yield* api.userEncryptionKeys.list();
    const own = items.find((key) => key.publicKey === recipient.publicKey);
    if (!own) {
      return yield* new IdentityError({
        message:
          "This device's encryption key is not registered. Run `better-update credentials identity register` first.",
      });
    }
    const wrap = yield* api.envVault
      .getWrap({
        path: { recipientKind: recipientKind(recipient.source), recipientId: own.id },
      })
      .pipe(
        Effect.catchTag(
          "NotFound",
          () => new IdentityError({ message: ENV_VAULT_NOT_RECIPIENT_GUIDANCE }),
        ),
      );
    const vaultKey = yield* Effect.tryPromise({
      try: async () => unwrapVaultKey({ wrapped: fromBase64(wrap.wrappedKey), privateKey }),
      catch: () =>
        new IdentityError({
          message:
            "This device could not unwrap the env-vault key — its env access may have been revoked or rotated. Re-enroll or ask an admin to re-grant access.",
        }),
    });
    return { vaultKey, vaultVersion: wrap.envVaultVersion, keyId: own.id } satisfies UnlockedVault;
  });

/**
 * Cache-aware env-vault unlock, mirroring {@link unlockVaultKeyInteractive} but on
 * the `"env"` cache namespace so the credentials and env vaults cache (and lock)
 * independently. CI's `BETTER_UPDATE_IDENTITY` key is never cached.
 */
export const unlockEnvVaultKeyInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const recipient = yield* activeRecipient;
    if (recipient.source !== "file") {
      return yield* unlockEnvVaultKey(api, undefined);
    }
    const cache = yield* VaultCache;
    const cached = yield* cache.get(recipient.publicKey, "env");
    if (cached !== undefined) {
      return cached.vault;
    }
    const passphrase = yield* promptPassword("Passphrase to unlock this device's identity:");
    const vault = yield* unlockEnvVaultKey(api, passphrase);
    yield* cache.set(recipient.publicKey, vault, { vaultKind: "env" });
    return vault;
  }).pipe(Effect.provide(VaultCacheLive));

/** Forget this device's cached env-vault key — called after an env rotation re-keys it. */
export const forgetCachedEnvVaultKey: Effect.Effect<
  void,
  IdentityError,
  Effect.Effect.Context<ReturnType<typeof unlockEnvVaultKeyInteractive>>
> = Effect.gen(function* () {
  const recipient = yield* activeRecipient;
  const cache = yield* VaultCache;
  yield* cache.clear(recipient.publicKey, "env");
}).pipe(Effect.provide(VaultCacheLive));

/**
 * Resolve the vault session env VALUES are sealed under, branched on the org's
 * cutover state. Pre-cutover (or no vault yet) env lives in the CREDENTIALS vault —
 * `openVaultSessionInteractive` returns a `"credentials"`-kind session, byte-for-
 * byte the pre-split behaviour. Once the org has cut over, env lives in its own
 * vault: unlock the env key and return an `"env"`-kind session so seal/open bind
 * the DEK to the env vault. Every env command (`set/get/pull/push/export/import`)
 * goes through this, so the cutover is transparent to them.
 */
export const openEnvVaultSessionInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const vault = yield* api.orgVault
      .get()
      .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));
    // No vault yet, or env still in the credentials vault → the credentials
    // session (its `"credentials"` kind keeps env byte-identical to pre-split).
    const cutoverAt = vault === null ? null : vault.envVaultCutoverAt;
    if (cutoverAt === null) {
      return yield* openVaultSessionInteractive(api);
    }
    const orgId = yield* getActiveOrgId(api);
    const ev = yield* unlockEnvVaultKeyInteractive(api);
    return { orgId, vault: ev, vaultKind: "env" } satisfies VaultSession;
  });
