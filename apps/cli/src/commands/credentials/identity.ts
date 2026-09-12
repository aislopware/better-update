import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import type { UserEncryptionKey } from "@better-update/api";

import {
  activeRecipient,
  createLocalIdentity,
  loadIdentityFileOrFail,
  registerRecipient,
} from "../../application/identity";
import {
  orgVaultExists,
  VAULT_NOT_RECIPIENT_GUIDANCE,
  VAULT_NOT_SET_UP_GUIDANCE,
} from "../../application/vault-access";
import { bootstrapVault } from "../../application/vault-bootstrap";
import { IdentityError } from "../../lib/exit-codes";
import { printHuman, printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { promptPassword, promptText } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
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

const createCommand = Command.make(
  "create",
  {
    label: Flag.String("label").pipe(
      Flag.withDescription("Human label for this device key (defaults to your username)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
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
    const vaultGuidance = yield* orgVaultExists(api).pipe(
      Effect.map((exists) => (exists ? VAULT_NOT_RECIPIENT_GUIDANCE : VAULT_NOT_SET_UP_GUIDANCE)),
      Effect.orElseSucceed(() => VAULT_NOT_RECIPIENT_GUIDANCE),
    );
    yield* printHuman(vaultGuidance);
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Create this device's encryption identity and register it as a recipient",
  ),
);

const registerCommand = Command.make(
  "register",
  {
    label: Flag.String("label").pipe(
      Flag.withDescription("Human label for this device key (defaults to your username)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
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
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Register this device's existing identity as a recipient (retry after create)",
  ),
);

const showHandler = Effect.fn(function* () {
  const recipient = yield* activeRecipient;
  yield* printKeyValue([
    ["Source", recipient.source === "env" ? "robot (env)" : "~/.better-update/identity.json"],
    ["Recipient (public key)", recipient.publicKey],
    ["Fingerprint", recipient.fingerprint],
  ]);
}, runCommand());

const showCommand = Command.make("show", {}, showHandler).pipe(
  Command.withDescription("Show this device's encryption recipient (public key + fingerprint)"),
);

const initCommand = Command.make(
  "init",
  {
    label: Flag.String("label").pipe(
      Flag.withDescription("Human label for this device key if it still needs registering"),
      optionalFlag,
    ),
  },
  (args) =>
    Effect.gen(function* () {
      const api = yield* apiClient;
      const recipient = yield* activeRecipient;
      const { items } = yield* api.userEncryptionKeys.list();
      const existing = items.find((key) => key.publicKey === recipient.publicKey);
      const ensureRegistered = existing
        ? Effect.succeed(existing)
        : Effect.gen(function* () {
            if (recipient.source !== "file") {
              return yield* new IdentityError({
                message:
                  "Bootstrap the vault from an admin's own device identity, not a robot's. Run `better-update credentials identity create` here first, or mint the org's first robot with `better-update credentials robot create` after the vault exists.",
              });
            }
            const label = yield* resolveLabel(args.label);
            return yield* registerRecipient(api, {
              kind: "device",
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
    })
      .pipe(
        Effect.catchTag("Conflict", () =>
          printHuman(
            "The org vault is already initialized. If this device can't decrypt credentials yet, ask an admin to grant it access — or self-link from a device that already has it.",
          ),
        ),
      )
      .pipe(runCommand()),
).pipe(
  Command.withDescription(
    "Bootstrap the org credential vault (first-time setup): create the vault key and an offline recovery key",
  ),
);

export const identityCommand = Command.make("identity", {}, showHandler).pipe(
  Command.withDescription("Manage this device's end-to-end encryption identity"),
  Command.withSubcommands([createCommand, initCommand, registerCommand, showCommand]),
);
