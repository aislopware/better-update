import { unwrapVaultKey, wrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

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
 * a SEPARATE key from the credentials vault, so a device granted before
 * `access grant` covered both vaults may read credentials yet not be an env
 * recipient — an admin backfills it with `access grant-env`; a CI robot with
 * `robot grant-env`.
 */
export const ENV_VAULT_NOT_RECIPIENT_GUIDANCE =
  "This device isn't an env-vault recipient. Ask an admin to run `better-update credentials access grant-env <key id or fingerprint>` (see `credentials device list` for yours), or — for a CI robot — `better-update credentials robot grant-env <robot-id>`.";

/** `true` once the org has cut over to its separate env vault. */
export const orgHasCutOver = (api: ApiClient) =>
  api.orgVault.get().pipe(
    Effect.map((vault) => vault.envVaultCutoverAt !== null),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );

/**
 * Wrap the (already-unlocked) env-vault key to another org recipient — a robot's
 * machine key — and push the wrap row at the version it was unlocked from (the
 * server CAS-rejects it if the env vault rotated underneath). Mirrors
 * `grantRecipient` on the credentials vault; the per-user account-key self-link
 * lives in `commands/credentials/account.ts`.
 */
export const grantEnvRecipient = (args: {
  readonly api: ApiClient;
  readonly vault: UnlockedVault;
  readonly target: UserEncryptionKey;
}) =>
  Effect.gen(function* () {
    const wrapped = yield* Effect.promise(async () =>
      wrapVaultKey({ vaultKey: args.vault.vaultKey, recipient: args.target.publicKey }),
    );
    return yield* args.api.envVault.addWrap({
      payload: {
        envVaultVersion: args.vault.vaultVersion,
        wrap: {
          recipientKind: args.target.kind,
          recipientId: args.target.id,
          wrappedKey: toBase64(wrapped),
        },
      },
    });
  });

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
 * independently. A CI robot's env-sourced key is never cached.
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

/** `true` while a key recipient (device/machine/recovery) holds a wrap on the CURRENT env vault. */
export const keyHoldsEnvWrap = (api: ApiClient, keyId: string) =>
  api.envVault.listWraps().pipe(
    Effect.map(({ recipients }) =>
      recipients.some((wrap) => wrap.recipientKind !== "account" && wrap.recipientId === keyId),
    ),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );

/**
 * Unlock the env vault from this device and wrap it to `target`, idempotently.
 * `addWrap` answers Conflict for BOTH a duplicate wrap and a stale
 * `envVaultVersion` (a cached env key outlives rotations made from other
 * devices), so only report "already" when the wrap really exists — otherwise
 * drop the stale cache and grant once more against the freshly-fetched version.
 */
export const grantEnvRecipientIdempotent = (api: ApiClient, target: UserEncryptionKey) => {
  const grantOnce = Effect.gen(function* () {
    const vault = yield* unlockEnvVaultKeyInteractive(api);
    yield* grantEnvRecipient({ api, vault, target });
  });
  return grantOnce.pipe(
    Effect.as("granted" as const),
    Effect.catchTag("Conflict", () =>
      Effect.gen(function* () {
        if (yield* keyHoldsEnvWrap(api, target.id)) {
          return "already" as const;
        }
        yield* forgetCachedEnvVaultKey;
        yield* grantOnce;
        return "granted" as const;
      }),
    ),
  );
};

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
