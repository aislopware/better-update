import { defineCommand } from "citty";
import { Effect, Either } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { activeRecipient } from "../../application/identity";
import { findRecipient, grantRecipient } from "../../application/vault-access";
import { runEffect } from "../../lib/citty-effect";
import { IdentityError } from "../../lib/exit-codes";
import { printHuman, printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { confirmFingerprint, resolveSelector, unlockVaultInteractively } from "./vault-session";

/** Self-linking is for your own device keys; recovery/machine keys go through `access grant`. */
const requireDeviceKind = (target: UserEncryptionKey): Effect.Effect<void, IdentityError> =>
  target.kind === "device"
    ? Effect.void
    : new IdentityError({
        message: `Key ${target.id} is a ${target.kind} key, not a device. Use \`better-update credentials access grant\` for recovery/machine keys.`,
      });

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List your registered device keys (the active one is marked)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const active = yield* Effect.either(activeRecipient);
        const activeKey = Either.isRight(active) ? active.right.publicKey : null;
        const { items } = yield* api.userEncryptionKeys.list();
        const devices = items.filter((key) => key.kind === "device");
        yield* printList(
          ["Key ID", "Label", "Fingerprint", "Active"],
          devices.map((key) => [
            key.id,
            key.label,
            key.fingerprint,
            key.publicKey === activeKey ? "*" : "",
          ]),
          "No device keys registered.",
        );
      }),
    ),
});

const linkCommand = defineCommand({
  meta: {
    name: "link",
    description: "Grant a new device of yours access to the vault (self-service)",
  },
  args: {
    device: {
      type: "positional",
      required: false,
      description: "Key id or fingerprint of your new device (shown after `identity create`)",
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
        const selector = yield* resolveSelector(args.device, "New device key id or fingerprint:");
        const target = yield* findRecipient(api, selector);
        yield* requireDeviceKind(target);
        yield* confirmFingerprint(target, args.yes === true);
        const vault = yield* unlockVaultInteractively(api);
        yield* grantRecipient({ api, vault, target });
        yield* printHuman(`Linked device ${target.label} (${target.fingerprint}) to the vault.`);
      }),
    ),
});

export const deviceCommand = defineCommand({
  meta: {
    name: "device",
    description: "Manage your vault device keys",
  },
  subCommands: {
    list: listCommand,
    link: linkCommand,
  },
  default: "list",
});
