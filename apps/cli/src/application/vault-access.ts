import { openIdentity, unwrapVaultKey, wrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { IdentityError } from "../lib/exit-codes";
import { promptPassword } from "../lib/prompts";
import { CliRuntime } from "../services/cli-runtime";
import { activeRecipient, loadIdentityFileOrFail } from "./identity";

import type { InteractiveProhibitedError } from "../lib/exit-codes";
import type { InteractiveMode } from "../lib/interactive-mode";
import type { ApiClient } from "../services/api-client";
import type { IdentityStore } from "../services/identity-store";

/** The org vault key unlocked locally, tagged with the version + recipient it came from. */
export interface UnlockedVault {
  readonly vaultKey: Uint8Array;
  readonly vaultVersion: number;
  readonly keyId: string;
}

/**
 * Resolve this device's age private key. The CI `BETTER_UPDATE_IDENTITY` env key
 * is used raw (no passphrase); otherwise the on-disk envelope is opened with the
 * supplied passphrase. `openIdentity` re-derives — and the seal authenticates —
 * the public key, so a wrong passphrase or a tampered file fails here.
 */
export const unlockActivePrivateKey = (
  passphrase: string | undefined,
): Effect.Effect<string, IdentityError, CliRuntime | IdentityStore> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const envKey = yield* runtime.getEnv("BETTER_UPDATE_IDENTITY");
    if (envKey !== undefined && envKey.length > 0) {
      return envKey;
    }
    const file = yield* loadIdentityFileOrFail;
    if (passphrase === undefined) {
      return yield* new IdentityError({
        message: "A passphrase is required to unlock ~/.better-update/identity.json.",
      });
    }
    const identity = yield* Effect.tryPromise({
      try: async () => openIdentity({ file, passphrase }),
      catch: () =>
        new IdentityError({
          message:
            "Could not unlock this device's identity — wrong passphrase, or the identity file was altered.",
        }),
    });
    return identity.privateKey;
  });

/**
 * Turn a missing-wrap `NotFound` into actionable guidance by asking the server
 * whether the org vault exists at all. A fresh org has no vault yet — the first
 * member must run `credentials identity init` (which also mints the offline
 * recovery key); an existing vault means this device simply isn't a recipient,
 * so it needs an admin grant or a self-link from a device that already has it.
 */
const vaultAccessError = (api: ApiClient) =>
  Effect.gen(function* () {
    const vaultExists = yield* api.orgVault.get().pipe(
      Effect.as(true),
      Effect.catchTag("NotFound", () => Effect.succeed(false)),
    );
    return yield* new IdentityError({
      message: vaultExists
        ? "This device isn't a vault recipient yet. Ask an org admin to run `better-update credentials access grant`, or self-link from a device that already has access with `better-update credentials device link`."
        : "This organization's credential vault isn't set up yet. Run `better-update credentials identity init` to bootstrap it — you'll get a one-time offline recovery key to store safely.",
    });
  });

/**
 * Unlock the org vault key for this device: find this device's recipient row,
 * fetch its wrap, and unwrap it with the local private key. A missing wrap is
 * resolved by {@link vaultAccessError} into init-vs-grant guidance; an unwrap
 * failure means access was revoked or rotated.
 */
export const unlockVaultKey = (api: ApiClient, passphrase: string | undefined) =>
  Effect.gen(function* () {
    const recipient = yield* activeRecipient;
    const privateKey = yield* unlockActivePrivateKey(passphrase);
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
 * Resolve the passphrase needed to unlock the active identity before a crypto
 * operation: prompt for it when the identity is the on-disk file, or return
 * `undefined` when the raw `BETTER_UPDATE_IDENTITY` env key is in use (CI). The
 * resolved value is threaded into {@link unlockVaultKey} by the cipher helpers.
 */
export const resolveVaultPassphrase: Effect.Effect<
  string | undefined,
  IdentityError | InteractiveProhibitedError,
  CliRuntime | IdentityStore | InteractiveMode
> = Effect.gen(function* () {
  const recipient = yield* activeRecipient;
  return recipient.source === "file"
    ? yield* promptPassword("Passphrase to unlock this device's identity:")
    : undefined;
});

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
