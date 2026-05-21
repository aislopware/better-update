import { defineCommand } from "citty";
import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import {
  activeRecipient,
  createLocalIdentity,
  loadIdentityFileOrFail,
  recipientKind,
  registerRecipient,
} from "../../application/identity";
import { bootstrapVault } from "../../application/vault-bootstrap";
import { runEffect } from "../../lib/citty-effect";
import { IdentityError } from "../../lib/exit-codes";
import { printHuman, printKeyValue } from "../../lib/output";
import { promptPassword, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const resolveLabel = (flag: string | undefined) =>
  Effect.gen(function* () {
    if (flag && flag.trim().length > 0) {
      return flag.trim();
    }
    const runtime = yield* CliRuntime;
    const userName = yield* runtime.userName;
    return yield* promptText("Label for this device key", { defaultValue: userName });
  });

const promptNewPassphrase = Effect.gen(function* () {
  const first = yield* promptPassword("Choose a passphrase to protect this device key:");
  if (first.length === 0) {
    return yield* new IdentityError({ message: "Passphrase must not be empty." });
  }
  const confirmation = yield* promptPassword("Confirm passphrase:");
  if (first !== confirmation) {
    return yield* new IdentityError({ message: "Passphrases did not match." });
  }
  return first;
});

const printRecipient = (key: UserEncryptionKey) =>
  printKeyValue([
    ["Label", key.label],
    ["Recipient (public key)", key.publicKey],
    ["Fingerprint", key.fingerprint],
  ]);

const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create this device's encryption identity and register it as a recipient",
  },
  args: {
    label: {
      type: "string",
      description: "Human label for this device key (defaults to your username)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const label = yield* resolveLabel(args.label);
        const passphrase = yield* promptNewPassphrase;
        const identity = yield* createLocalIdentity(passphrase);
        const api = yield* apiClient;
        const registered = yield* registerRecipient(api, {
          kind: "device",
          publicKey: identity.publicKey,
          fingerprint: identity.fingerprint,
          label,
        });
        yield* printRecipient(registered);
        yield* printHuman("");
        yield* printHuman(
          "Sealed at ~/.better-update/identity.json — the private key never leaves this machine.",
        );
        yield* printHuman(
          "Before you can read or upload credentials, this device needs vault access — granted by an org admin, or self-linked from another device that already has it.",
        );
      }),
    ),
});

const registerCommand = defineCommand({
  meta: {
    name: "register",
    description: "Register this device's existing identity as a recipient (retry after create)",
  },
  args: {
    label: {
      type: "string",
      description: "Human label for this device key (defaults to your username)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const file = yield* loadIdentityFileOrFail;
        const label = yield* resolveLabel(args.label);
        const api = yield* apiClient;
        const registered = yield* registerRecipient(api, {
          kind: "device",
          publicKey: file.publicKey,
          fingerprint: file.fingerprint,
          label,
        });
        yield* printRecipient(registered);
      }),
    ),
});

const showCommand = defineCommand({
  meta: {
    name: "show",
    description: "Show this device's encryption recipient (public key + fingerprint)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const recipient = yield* activeRecipient;
        yield* printKeyValue([
          [
            "Source",
            recipient.source === "env"
              ? "BETTER_UPDATE_IDENTITY (env)"
              : "~/.better-update/identity.json",
          ],
          ["Recipient (public key)", recipient.publicKey],
          ["Fingerprint", recipient.fingerprint],
        ]);
      }),
    ),
});

const initCommand = defineCommand({
  meta: {
    name: "init",
    description:
      "Bootstrap the org credential vault (first-time setup): create the vault key and an offline recovery key",
  },
  args: {
    label: {
      type: "string",
      description: "Human label for this device key if it still needs registering",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const recipient = yield* activeRecipient;
        const { items } = yield* api.userEncryptionKeys.list();
        const existing = items.find((key) => key.publicKey === recipient.publicKey);
        const ensureRegistered = existing
          ? Effect.succeed(existing)
          : Effect.gen(function* () {
              const label = yield* resolveLabel(args.label);
              return yield* registerRecipient(api, {
                kind: recipientKind(recipient.source),
                publicKey: recipient.publicKey,
                fingerprint: recipient.fingerprint,
                label,
              });
            });
        const deviceKey = yield* ensureRegistered;

        const result = yield* bootstrapVault({
          api,
          deviceKeyId: deviceKey.id,
          deviceRecipient: recipient.publicKey,
        });

        yield* printHuman(
          "✓ Org credential vault bootstrapped — this device can now upload and read credentials.",
        );
        yield* printHuman("");
        yield* printHuman(
          "⚠  The recovery private key below is shown ONCE and is never stored. Save it offline now —",
        );
        yield* printHuman(
          "   it can decrypt every credential and is the only break-glass if every device loses access.",
        );
        yield* printHuman("");
        yield* printKeyValue([
          ["Vault version", String(result.vaultVersion)],
          ["Recovery fingerprint", result.recoveryFingerprint],
          ["Recovery private key", result.recoveryPrivateKey],
        ]);
      }).pipe(
        Effect.catchTag("Conflict", () =>
          printHuman(
            "The org vault is already initialized. If this device can't decrypt credentials yet, ask an admin to grant it access — or self-link from a device that already has it.",
          ),
        ),
      ),
    ),
});

export const identityCommand = defineCommand({
  meta: {
    name: "identity",
    description: "Manage this device's end-to-end encryption identity",
  },
  subCommands: {
    create: createCommand,
    init: initCommand,
    register: registerCommand,
    show: showCommand,
  },
  default: "show",
});
