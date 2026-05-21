import { defineCommand } from "citty";
import { Effect } from "effect";

import { findRecipient, grantRecipient } from "../../application/vault-access";
import { runEffect } from "../../lib/citty-effect";
import { printHuman, printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { confirmFingerprint, resolveSelector, unlockVaultInteractively } from "./vault-session";

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List recipients that currently hold the org vault key",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const [{ recipients, vaultVersion }, { items }] = yield* Effect.all([
          api.orgVault.listWraps(),
          api.userEncryptionKeys.list(),
        ]);
        const byId = new Map(items.map((key) => [key.id, key]));
        yield* printHuman(`Vault version ${vaultVersion}`);
        yield* printList(
          ["Key ID", "Kind", "Label", "Fingerprint"],
          recipients.map((recipient) => {
            const key = byId.get(recipient.userEncryptionKeyId);
            return [
              recipient.userEncryptionKeyId,
              key?.kind ?? "?",
              key?.label ?? "(unknown)",
              key?.fingerprint ?? "-",
            ];
          }),
          "No recipients hold the vault key yet.",
        );
      }),
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
      }),
    ),
});

export const accessCommand = defineCommand({
  meta: {
    name: "access",
    description: "Inspect and grant access to the org credential vault",
  },
  subCommands: {
    list: listCommand,
    grant: grantCommand,
  },
  default: "list",
});
