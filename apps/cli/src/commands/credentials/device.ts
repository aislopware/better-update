import { Effect, Result } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import type { UserEncryptionKey } from "@better-update/api";

import { grantEnvRecipientIdempotent, orgHasCutOver } from "../../application/env-vault-access";
import { activeRecipient } from "../../application/identity";
import { findRecipient, grantRecipient } from "../../application/vault-access";
import { IdentityError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
import { printHuman, printList } from "../../lib/output";
import { optionalArgument, yesFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { confirmFingerprint, resolveSelector, unlockVaultInteractively } from "./vault-session";

/** Self-linking is for your own device keys; recovery/machine keys go through `access grant`. */
const requireDeviceKind = (target: UserEncryptionKey): Effect.Effect<void, IdentityError> =>
  target.kind === "device"
    ? Effect.void
    : new IdentityError({
        message: `Key ${target.id} is a ${target.kind} key, not a device. Use \`better-update credentials access grant\` for recovery/machine keys.`,
      });

const listHandler = Effect.fn(function* () {
  const api = yield* apiClient;
  const active = yield* Effect.result(activeRecipient);
  const activeKey = Result.isSuccess(active) ? active.success.publicKey : null;
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
}, runCommand());

const listCommand = Command.make("list", {}, listHandler).pipe(
  Command.withDescription("List your registered device keys (the active one is marked)"),
);

const linkCommand = Command.make(
  "link",
  {
    device: Argument.String("device").pipe(
      Argument.withDescription(
        "Key id or fingerprint of your new device (shown after `identity create`)",
      ),
      optionalArgument,
    ),
    yes: yesFlag("Skip the out-of-band fingerprint confirmation prompt"),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const selector = yield* resolveSelector(args.device, "New device key id or fingerprint:");
    const target = yield* findRecipient(api, selector);
    yield* requireDeviceKind(target);
    yield* confirmFingerprint(target, args.yes);
    const vault = yield* unlockVaultInteractively(api);
    yield* grantRecipient({ api, vault, target });
    yield* printHuman(`Linked device ${target.label} (${target.fingerprint}) to the vault.`);
    // Post-cutover the env vault is a SEPARATE key — self-link the new
    // device as an env recipient too (own-device wraps are self-service).
    // Best-effort: the credentials link already landed, so a failure here
    // degrades to the `access grant-env` hand-off.
    const envLinked = (yield* orgHasCutOver(api))
      ? yield* grantEnvRecipientIdempotent(api, target).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            printHuman(
              `⚠ Env vault not linked: ${formatCause(error)}\n` +
                `  Link it later: better-update credentials access grant-env ${target.id}`,
            ).pipe(Effect.as(false)),
          ),
        )
      : false;
    if (envLinked) {
      yield* printHuman(`✓ Granted env-vault access to ${target.label}.`);
    }
  }, runCommand()),
).pipe(Command.withDescription("Grant a new device of yours access to the vault (self-service)"));

export const deviceCommand = Command.make("device", {}, listHandler).pipe(
  Command.withDescription("Manage your vault device keys"),
  Command.withSubcommands([listCommand, linkCommand]),
);
