import { generateIdentity, unwrapVaultKey, wrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64, toBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import type { UserEncryptionKey } from "@better-update/api";

import { grantEnvRecipientIdempotent, orgHasCutOver } from "../../application/env-vault-access";
import { activeRecipient } from "../../application/identity";
import { findRecipient, grantRecipient } from "../../application/vault-access";
import { currentRecipients, rotateVaultTo } from "../../application/vault-rotation";
import { IdentityError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
import { printHuman, printHumanKeyValue, printHumanList } from "../../lib/output";
import { optionalArgument, optionalFlag, yesFlag } from "../../lib/params";
import { promptConfirm } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import {
  confirmFingerprint,
  printRecipientDetails,
  resolveSelector,
  unlockVaultInteractively,
} from "./vault-session";

import type { RotationRecipient } from "../../application/vault-rotation";

const RECOVERY_LABEL = "Offline recovery key";

// Exported for reuse by `credentials robot revoke`, which drives the same
// exclude-and-rotate flow for a robot's linked vault identity.
export const toRotationRecipient = (key: UserEncryptionKey): RotationRecipient => ({
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

const listHandler = Effect.fn(
  function* () {
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
  },
  runCommand({ json: "value" }),
);

const listCommand = Command.make("list", {}, listHandler).pipe(
  Command.withDescription("List recipients that currently hold the org vault key"),
);

const grantCommand = Command.make(
  "grant",
  {
    recipient: Argument.String("recipient").pipe(
      Argument.withDescription("Key id or fingerprint of the recipient to grant"),
      optionalArgument,
    ),
    yes: yesFlag("Skip the out-of-band fingerprint confirmation prompt"),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const selector = yield* resolveSelector(args.recipient, "Recipient key id or fingerprint:");
      const target = yield* findRecipient(api, selector);
      yield* confirmFingerprint(target, args.yes);
      const vault = yield* unlockVaultInteractively(api);
      yield* grantRecipient({ api, vault, target });
      yield* printHuman(`Granted vault access to ${target.label} (${target.fingerprint}).`);
      // Post-cutover the env vault is a SEPARATE key, so the grant above does
      // not cover env decryption — wrap the env key to the same recipient.
      // Best-effort: the credentials grant already landed, so a failure here
      // degrades to the `access grant-env` hand-off instead of sinking the
      // command. Pre-cutover env is sealed under the credentials vault:
      // nothing extra to grant.
      const envGranted = (yield* orgHasCutOver(api))
        ? yield* grantEnvRecipientIdempotent(api, target).pipe(
            Effect.as(true),
            Effect.catch((error) =>
              printHuman(
                `⚠ Env vault not granted: ${formatCause(error)}\n` +
                  `  Grant it later: better-update credentials access grant-env ${target.id}`,
              ).pipe(Effect.as(false)),
            ),
          )
        : false;
      if (envGranted) {
        yield* printHuman(`✓ Granted env-vault access to ${target.label}.`);
      }
      return {
        granted: true,
        envGranted,
        recipient: { id: target.id, fingerprint: target.fingerprint },
      };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Grant another recipient access to the vault — credentials and, post-cutover, env (admin/owner)",
  ),
);

const grantEnvCommand = Command.make(
  "grant-env",
  {
    recipient: Argument.String("recipient").pipe(
      Argument.withDescription("Key id or fingerprint of the recipient to grant"),
      optionalArgument,
    ),
    yes: yesFlag("Skip the out-of-band fingerprint confirmation prompt"),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const selector = yield* resolveSelector(args.recipient, "Recipient key id or fingerprint:");
      const target = yield* findRecipient(api, selector);
      if (!(yield* orgHasCutOver(api))) {
        return yield* new IdentityError({
          message:
            "This organization's env values are still sealed under the credentials vault (no env cutover) — a credentials-vault grant already covers env; nothing to do.",
        });
      }
      yield* confirmFingerprint(target, args.yes);
      const outcome = yield* grantEnvRecipientIdempotent(api, target);
      yield* printHuman(
        outcome === "granted"
          ? `✓ Granted env-vault access to ${target.label} (${target.fingerprint}).`
          : `${target.label} is already an env-vault recipient — nothing to do.`,
      );
      return {
        envGranted: true,
        alreadyGranted: outcome === "already",
        recipient: { id: target.id, fingerprint: target.fingerprint },
      };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Grant an existing recipient access to the env vault alone — backfill for one granted before `access grant` covered both vaults (admin/owner)",
  ),
);

// Exported for reuse by `credentials robot revoke` (see toRotationRecipient above).
// The header makes clear the keys listed below are the SURVIVORS the rotated key
// is re-wrapped to — not whatever is being revoked. One confirmation covers the
// whole list — per-recipient prompts made revoking from a large org a slog.
export const confirmRecipients = (recipients: readonly UserEncryptionKey[], skip: boolean) =>
  Effect.gen(function* () {
    yield* printHuman("The rotated vault key will be re-wrapped to these recipients:");
    yield* Effect.forEach(recipients, printRecipientDetails, { discard: true });
    if (skip) {
      return undefined;
    }
    const verified = yield* promptConfirm(
      "Have you verified these recipient fingerprints out-of-band?",
      { initialValue: false },
    );
    if (!verified) {
      return yield* new IdentityError({
        message: "Cancelled — verify the recipient fingerprints out-of-band first.",
      });
    }
    return undefined;
  });

const rotateCommand = Command.make(
  "rotate",
  {
    yes: yesFlag("Skip the out-of-band fingerprint confirmation prompt"),
  },
  Effect.fn(
    function* (args) {
      const api = yield* apiClient;
      const recipients = yield* currentRecipients(api);
      yield* confirmRecipients(recipients, args.yes);
      const rotated = yield* rotateVaultTo({
        api,
        recipients: recipients.map(toRotationRecipient),
      });
      yield* printHuman(
        `Rotated the vault to version ${String(rotated.vaultVersion)} (${String(recipients.length)} recipients).`,
      );
      return { vaultVersion: rotated.vaultVersion, recipients: recipients.length };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Rotate the vault key, re-wrapping every credential to the same recipients (admin)",
  ),
);

const revokeCommand = Command.make(
  "revoke",
  {
    recipient: Argument.String("recipient").pipe(
      Argument.withDescription("Key id or fingerprint of the recipient to revoke"),
      optionalArgument,
    ),
    yes: yesFlag("Skip the out-of-band fingerprint confirmation prompt"),
  },
  Effect.fn(
    function* (args) {
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
      yield* confirmRecipients(surviving, args.yes);
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Revoke a recipient and rotate the vault key so they can no longer decrypt (admin)",
  ),
);

const recoverCommand = Command.make(
  "recover",
  {
    key: Flag.String("key").pipe(
      Flag.withDescription(
        "The offline recovery private key (AGE-SECRET-KEY-1...); prompted if omitted",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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

      const wrap = yield* api.orgVault.getWrap({ params: { keyId: recovery.id } });
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Restore this device's vault access with the offline recovery private key",
  ),
);

const recoveryRotateHandler = Effect.fn(
  function* (args: { readonly yes: boolean }) {
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
    yield* confirmRecipients(surviving, args.yes);
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
  },
  runCommand({ json: "value" }),
);

const recoveryRotateCommand = Command.make(
  "rotate",
  {
    yes: yesFlag("Skip the out-of-band fingerprint confirmation prompt"),
  },
  recoveryRotateHandler,
).pipe(
  Command.withDescription(
    "Mint a new offline recovery key and rotate the vault, revoking the old one (admin)",
  ),
);

const recoveryCommand = Command.make("recovery", {}, () =>
  recoveryRotateHandler({ yes: false }),
).pipe(
  Command.withDescription("Manage the offline recovery recipient"),
  Command.withSubcommands([recoveryRotateCommand]),
);

export const accessCommand = Command.make("access", {}, listHandler).pipe(
  Command.withDescription(
    "Inspect, grant, rotate, revoke, and recover access to the org credential vault",
  ),
  Command.withSubcommands([
    listCommand,
    grantCommand,
    grantEnvCommand,
    rotateCommand,
    revokeCommand,
    recoverCommand,
    recoveryCommand,
  ]),
);
