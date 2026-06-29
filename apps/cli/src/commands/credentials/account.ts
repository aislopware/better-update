import {
  generateAccountKey,
  openAccountKey,
  openIdentity,
  sealAccountKey,
  wrapVaultKey,
} from "@better-update/credentials-crypto";
import { toBase64 } from "@better-update/encoding";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { unlockEnvVaultKeyInteractive } from "../../application/env-vault-access";
import { loadIdentityFileOrFail } from "../../application/identity";
import { escrowToEnvelope } from "../../application/passphrase-change";
import { runEffect } from "../../lib/citty-effect";
import { IdentityError } from "../../lib/exit-codes";
import { printHuman, printKeyValue } from "../../lib/output";
import { promptPassword } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

import type { ApiClient } from "../../services/api-client";

/** `true` once the org has cut over to its separate env vault. */
const orgHasCutOver = (api: ApiClient) =>
  api.orgVault.get().pipe(
    Effect.map((vault) => vault.envVaultCutoverAt !== null),
    Effect.catchTag("NotFound", () => Effect.succeed(false)),
  );

/** The caller's live account key (public escrow view), or `null` if not enrolled. */
const findOwnAccountKey = (api: ApiClient) =>
  api.accountKeys.getMe().pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));

/**
 * Wrap the env-vault key to the caller's OWN account key (self-link). Unlocks the
 * env vault via this device's env wrap, so it works for any member whose device is
 * already an env recipient — the account key inherits env access without an admin.
 * Requires the org to have cut over (there is no env vault before that).
 */
const linkAccountKeyToEnv = (
  api: ApiClient,
  params: { readonly accountKeyId: string; readonly agePublicKey: string },
) =>
  Effect.gen(function* () {
    const ev = yield* unlockEnvVaultKeyInteractive(api);
    const wrapped = yield* Effect.promise(async () =>
      wrapVaultKey({ vaultKey: ev.vaultKey, recipient: params.agePublicKey }),
    );
    yield* api.envVault.addWrap({
      payload: {
        envVaultVersion: ev.vaultVersion,
        wrap: {
          recipientKind: "account",
          recipientId: params.accountKeyId,
          wrappedKey: toBase64(wrapped),
        },
      },
    });
  });

/**
 * Prompt for — and verify — the device passphrase, so the account escrow is sealed
 * under the SAME passphrase as the device identity (the "one passphrase" promise:
 * a later `passphrase change` re-seals both). Verifying via `openIdentity` also
 * stops a typo from minting an escrow no one can open.
 */
const promptVerifiedDevicePassphrase = Effect.gen(function* () {
  const file = yield* loadIdentityFileOrFail;
  const passphrase = yield* promptPassword(
    "Passphrase for this device's identity (the account key uses the same one):",
  );
  yield* Effect.tryPromise({
    try: async () => openIdentity({ file, passphrase }),
    catch: () =>
      new IdentityError({
        message: "Wrong passphrase — could not unlock this device's identity.",
      }),
  });
  return passphrase;
});

const createCommand = defineCommand({
  meta: {
    name: "create",
    description:
      "Enroll this user's account key — the env-vault recipient that unlocks env values from the browser",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const existing = yield* findOwnAccountKey(api);
        if (existing !== null) {
          return yield* new IdentityError({
            message:
              "An account key is already enrolled for this user. Use `better-update credentials passphrase change` to re-seal it, or `better-update credentials account link` to (re)grant it env access.",
          });
        }

        const passphrase = yield* promptVerifiedDevicePassphrase;
        const material = yield* Effect.promise(async () => generateAccountKey());
        const envelope = sealAccountKey({ material, passphrase });
        const registered = yield* api.accountKeys.register({
          payload: {
            agePublicKey: envelope.agePublicKey,
            ed25519PublicKey: envelope.ed25519PublicKey,
            fingerprint: envelope.fingerprint,
            kdfParams: envelope.kdfParams,
            salt: envelope.salt,
            escrowCt: envelope.ct,
          },
        });

        // Orgs are born forked, so a bootstrapped org always has an env vault —
        // self-link so this account key can decrypt env immediately. `cutOver` is
        // only false if the org vault was never initialized at all.
        const cutOver = yield* orgHasCutOver(api);
        if (cutOver) {
          yield* linkAccountKeyToEnv(api, {
            accountKeyId: registered.id,
            agePublicKey: registered.agePublicKey,
          });
        }

        yield* printKeyValue([
          ["Account key fingerprint", registered.fingerprint],
          ["Env access", cutOver ? "granted (self-linked)" : "pending — vault not initialized"],
        ]);
        yield* printHuman(
          cutOver
            ? "Account key enrolled. You can now unlock env values from the browser after a 2FA step-up."
            : "Account key enrolled. It gains env access once the org vault is initialized (`better-update credentials identity init`).",
        );
        return { fingerprint: registered.fingerprint, envAccess: cutOver };
      }),
      { json: "value" },
    ),
});

const linkCommand = defineCommand({
  meta: {
    name: "link",
    description:
      "Grant your already-enrolled account key access to the env vault (after a rotation)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const own = yield* findOwnAccountKey(api);
        if (own === null) {
          return yield* new IdentityError({
            message:
              "No account key enrolled. Run `better-update credentials account create` first.",
          });
        }
        const cutOver = yield* orgHasCutOver(api);
        if (!cutOver) {
          return yield* new IdentityError({
            message:
              "This organization's vault is not initialized. Run `better-update credentials identity init` first.",
          });
        }
        yield* linkAccountKeyToEnv(api, { accountKeyId: own.id, agePublicKey: own.agePublicKey });
        yield* printHuman(`Linked account key ${own.fingerprint} to the env vault.`);
        return { linked: true, fingerprint: own.fingerprint };
      }),
      { json: "value" },
    ),
});

const promptNewAccountPassphrase = Effect.gen(function* () {
  const first = yield* promptPassword(
    "New passphrase (use this device's passphrase to keep them in sync):",
  );
  if (first.length === 0) {
    return yield* new IdentityError({ message: "Passphrase must not be empty." });
  }
  const confirmation = yield* promptPassword("Confirm new passphrase:");
  if (first !== confirmation) {
    return yield* new IdentityError({ message: "Passphrases did not match." });
  }
  return first;
});

const resealCommand = defineCommand({
  meta: {
    name: "reseal",
    description:
      "Re-seal your account key under a new passphrase — repair after a passphrase change on another device, or a reseal that failed mid-change",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const own = yield* findOwnAccountKey(api);
        if (own === null) {
          return yield* new IdentityError({
            message:
              "No account key enrolled. Run `better-update credentials account create` first.",
          });
        }
        const current = yield* promptPassword("Current account-key passphrase:");
        const material = yield* Effect.tryPromise({
          try: async () => openAccountKey({ envelope: escrowToEnvelope(own), passphrase: current }),
          catch: () => new IdentityError({ message: "Wrong current account-key passphrase." }),
        });
        const next = yield* promptNewAccountPassphrase;
        const sealed = sealAccountKey({ material, passphrase: next });
        yield* api.accountKeys.reseal({
          payload: { kdfParams: sealed.kdfParams, salt: sealed.salt, escrowCt: sealed.ct },
        });
        yield* printHuman(`Re-sealed account key ${own.fingerprint} under the new passphrase.`);
        return { resealed: true, fingerprint: own.fingerprint };
      }),
      { json: "value" },
    ),
});

const showCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show this user's enrolled account key (fingerprint + status)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const own = yield* findOwnAccountKey(api);
        if (own === null) {
          yield* printHuman(
            "No account key enrolled for this user. Run `better-update credentials account create` to enroll one.",
          );
          return { enrolled: false };
        }
        yield* printKeyValue([
          ["Account key fingerprint", own.fingerprint],
          ["Age recipient (public)", own.agePublicKey],
          ["Enrolled at", own.createdAt],
        ]);
        return { enrolled: true, fingerprint: own.fingerprint };
      }),
      { json: "value" },
    ),
});

export const accountCommand = defineCommand({
  meta: {
    name: "account",
    description: "Manage your per-user account key for browser-side env-vault access",
  },
  subCommands: {
    create: createCommand,
    link: linkCommand,
    reseal: resealCommand,
    show: showCommand,
  },
  default: "show",
});
