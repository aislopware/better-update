import { generateIdentity, unwrapVaultKey, wrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { activeRecipient } from "../../application/identity";
import { findRecipient, grantRecipient } from "../../application/vault-access";
import { currentRecipients, rotateVaultTo } from "../../application/vault-rotation";
import { runEffect } from "../../lib/citty-effect";
import { IdentityError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue, printHumanList } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { confirmFingerprint, resolveSelector, unlockVaultInteractively } from "./vault-session";

import type { RotationRecipient } from "../../application/vault-rotation";

const RECOVERY_LABEL = "Offline recovery key";

const toRotationRecipient = (key: UserEncryptionKey): RotationRecipient => ({
  userEncryptionKeyId: key.id,
  publicKey: key.publicKey,
});

// Build a recipient view row. Kept at module scope — NOT inside the `.map`
// callback below — so the object spread satisfies `prefer-object-spread` without
// tripping `no-map-spread` (the two rules conflict for an inline map + spread).
const toRecipientView = (userEncryptionKeyId: string, key: UserEncryptionKey | undefined) => ({
  userEncryptionKeyId,
  ...compact({ kind: key?.kind, label: key?.label, fingerprint: key?.fingerprint }),
});

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List recipients that currently hold the org vault key",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const [{ recipients, vaultVersion }, { items }, vault] = yield* Effect.all([
          api.orgVault.listWraps(),
          api.userEncryptionKeys.list(),
          api.orgVault.get(),
        ]);
        const byId = new Map(items.map((key) => [key.id, key]));
        yield* printHuman(`Vault version ${vaultVersion}`);
        if (vault.rotationPending) {
          yield* printHuman(
            `⚠ Rotation pending — a recipient was removed (${vault.rotationPendingReason ?? "vault access revoked"}). ` +
              "Credential downloads are blocked until you run `credentials access rotate`.",
          );
        }
        const rows = recipients.map((recipient) => {
          const key = byId.get(recipient.userEncryptionKeyId);
          return [
            recipient.userEncryptionKeyId,
            key?.kind ?? "?",
            key?.label ?? "(unknown)",
            key?.fingerprint ?? "-",
          ];
        });
        yield* printHumanList(
          ["Key ID", "Kind", "Label", "Fingerprint"],
          rows,
          "No recipients hold the vault key yet.",
        );
        return {
          vaultVersion,
          rotationPending: vault.rotationPending,
          recipients: recipients.map((recipient) =>
            toRecipientView(recipient.userEncryptionKeyId, byId.get(recipient.userEncryptionKeyId)),
          ),
        };
      }),
      { json: "value" },
    ),
});

const grantCommand = defineCommand({
  meta: {
    name: "grant",
    description: "Grant another recipient access to the vault (admin/owner)",
  },
  args: {
    recipient: {
      type: "positional",
      required: false,
      description: "Key id or fingerprint of the recipient to grant",
    },
    yes: {
      type: "boolean",
      description: "Skip the out-of-band fingerprint confirmation prompt",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const selector = yield* resolveSelector(args.recipient, "Recipient key id or fingerprint:");
        const target = yield* findRecipient(api, selector);
        yield* confirmFingerprint(target, args.yes === true);
        const vault = yield* unlockVaultInteractively(api);
        yield* grantRecipient({ api, vault, target });
        yield* printHuman(`Granted vault access to ${target.label} (${target.fingerprint}).`);
        return { granted: true, recipient: { id: target.id, fingerprint: target.fingerprint } };
      }),
      { json: "value" },
    ),
});

const confirmRecipients = (recipients: readonly UserEncryptionKey[], skip: boolean) =>
  Effect.forEach(recipients, (recipient) => confirmFingerprint(recipient, skip), { discard: true });

const rotateCommand = defineCommand({
  meta: {
    name: "rotate",
    description:
      "Rotate the vault key, re-wrapping every credential to the same recipients (admin)",
  },
  args: {
    yes: { type: "boolean", description: "Skip the out-of-band fingerprint confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const recipients = yield* currentRecipients(api);
        yield* confirmRecipients(recipients, args.yes === true);
        const rotated = yield* rotateVaultTo({
          api,
          recipients: recipients.map(toRotationRecipient),
        });
        yield* printHuman(
          `Rotated the vault to version ${String(rotated.vaultVersion)} (${String(recipients.length)} recipients).`,
        );
        return { vaultVersion: rotated.vaultVersion, recipients: recipients.length };
      }),
      { json: "value" },
    ),
});

const revokeCommand = defineCommand({
  meta: {
    name: "revoke",
    description:
      "Revoke a recipient and rotate the vault key so they can no longer decrypt (admin)",
  },
  args: {
    recipient: {
      type: "positional",
      required: false,
      description: "Key id or fingerprint of the recipient to revoke",
    },
    yes: { type: "boolean", description: "Skip the out-of-band fingerprint confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const selector = yield* resolveSelector(
          args.recipient,
          "Recipient key id or fingerprint to revoke:",
        );
        const target = yield* findRecipient(api, selector);
        const recipients = yield* currentRecipients(api);
        const surviving = recipients.filter((recipient) => recipient.id !== target.id);
        if (surviving.length === recipients.length) {
          return yield* new IdentityError({
            message: `${target.label} (${target.fingerprint}) is not a current vault recipient.`,
          });
        }
        if (!surviving.some((recipient) => recipient.kind === "recovery")) {
          return yield* new IdentityError({
            message:
              "Refusing to revoke the offline recovery recipient — rotate it with `credentials access recovery rotate` instead.",
          });
        }
        yield* confirmRecipients(surviving, args.yes === true);
        const rotated = yield* rotateVaultTo({
          api,
          recipients: surviving.map(toRotationRecipient),
        });
        yield* printHuman(
          `Revoked ${target.label} and rotated the vault to version ${String(rotated.vaultVersion)}.`,
        );
        return {
          revoked: { id: target.id, fingerprint: target.fingerprint },
          vaultVersion: rotated.vaultVersion,
        };
      }),
      { json: "value" },
    ),
});

const recoverCommand = defineCommand({
  meta: {
    name: "recover",
    description: "Restore this device's vault access with the offline recovery private key",
  },
  args: {
    key: {
      type: "string",
      description: "The offline recovery private key (AGE-SECRET-KEY-1...); prompted if omitted",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const recoveryPrivateKey = yield* resolveSelector(
          args.key,
          "Paste the offline recovery private key (AGE-SECRET-KEY-1...):",
        );

        const { items } = yield* api.userEncryptionKeys.list();
        const recovery = items.find((key) => key.kind === "recovery" && key.revokedAt === null);
        if (!recovery) {
          return yield* new IdentityError({
            message: "This organization has no active recovery recipient to recover from.",
          });
        }

        const recipient = yield* activeRecipient;
        const own = items.find((key) => key.publicKey === recipient.publicKey);
        if (!own) {
          return yield* new IdentityError({
            message:
              "This device's encryption key is not registered. Run `better-update credentials identity register` first.",
          });
        }

        const wrap = yield* api.orgVault.getWrap({ path: { keyId: recovery.id } });
        const vaultKey = yield* Effect.tryPromise({
          try: async () =>
            unwrapVaultKey({
              wrapped: fromBase64(wrap.wrappedKey),
              privateKey: recoveryPrivateKey,
            }),
          catch: () =>
            new IdentityError({
              message: "Could not unwrap the vault key — the recovery private key is wrong.",
            }),
        });

        const wrapped = yield* Effect.promise(async () =>
          wrapVaultKey({ vaultKey, recipient: own.publicKey }),
        );
        yield* api.orgVault.addWrap({
          payload: {
            vaultVersion: wrap.vaultVersion,
            wrap: { userEncryptionKeyId: own.id, wrappedKey: toBase64(wrapped) },
          },
        });
        yield* printHuman(`Recovered vault access for this device (${own.label}).`);
        return { recovered: true, keyId: own.id, label: own.label };
      }),
      { json: "value" },
    ),
});

const recoveryRotateCommand = defineCommand({
  meta: {
    name: "rotate",
    description:
      "Mint a new offline recovery key and rotate the vault, revoking the old one (admin)",
  },
  args: {
    yes: { type: "boolean", description: "Skip the out-of-band fingerprint confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const recipients = yield* currentRecipients(api);

        const newRecovery = yield* Effect.promise(async () => generateIdentity());
        const registered = yield* api.userEncryptionKeys.register({
          payload: {
            kind: "recovery",
            publicKey: newRecovery.publicKey,
            label: RECOVERY_LABEL,
            fingerprint: newRecovery.fingerprint,
          },
        });

        // Drop every old recovery recipient; the freshly-minted one takes its place.
        const surviving = recipients.filter((recipient) => recipient.kind !== "recovery");
        yield* confirmRecipients(surviving, args.yes === true);
        const rotated = yield* rotateVaultTo({
          api,
          recipients: [
            ...surviving.map(toRotationRecipient),
            { userEncryptionKeyId: registered.id, publicKey: newRecovery.publicKey },
          ],
        });

        yield* printHumanKeyValue([
          ["New recovery fingerprint", newRecovery.fingerprint],
          ["Vault version", String(rotated.vaultVersion)],
        ]);
        yield* printHuman(
          "Store this offline recovery private key safely — it is shown once and never again:",
        );
        yield* printHuman(newRecovery.privateKey);
        return {
          fingerprint: newRecovery.fingerprint,
          vaultVersion: rotated.vaultVersion,
          // Shown once: JSON consumers must capture this now (mirrors human output).
          privateKey: newRecovery.privateKey,
        };
      }),
      { json: "value" },
    ),
});

const recoveryCommand = defineCommand({
  meta: { name: "recovery", description: "Manage the offline recovery recipient" },
  subCommands: { rotate: recoveryRotateCommand },
  default: "rotate",
});

export const accessCommand = defineCommand({
  meta: {
    name: "access",
    description: "Inspect, grant, rotate, revoke, and recover access to the org credential vault",
  },
  subCommands: {
    list: listCommand,
    grant: grantCommand,
    rotate: rotateCommand,
    revoke: revokeCommand,
    recover: recoverCommand,
    recovery: recoveryCommand,
  },
  default: "list",
});
