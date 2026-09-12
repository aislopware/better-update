import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { changePassphrase } from "../../application/passphrase-change";
import { IdentityError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { promptPassword } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

import type { AccountResealOutcome } from "../../application/passphrase-change";

/** Human result for each account-escrow outcome of a device passphrase change. */
const ACCOUNT_OUTCOME_MESSAGE: Record<AccountResealOutcome, string> = {
  resealed: "Passphrase changed — this device's identity and your account key were both re-sealed.",
  absent: "Passphrase changed — this device's identity was re-sealed (no account key enrolled).",
  "passphrase-mismatch":
    "Passphrase changed for this device — but your account key is sealed under a DIFFERENT passphrase (likely changed on another device) and was left unchanged. Run `better-update credentials account reseal` to bring it onto this passphrase.",
  error:
    "Passphrase changed for this device — but your account key could not be re-sealed (the server was unreachable). Run `better-update credentials account reseal` to retry.",
};

const promptNewPassphrase = Effect.gen(function* () {
  const first = yield* promptPassword("Choose a new passphrase:");
  if (first.length === 0) {
    return yield* new IdentityError({ message: "Passphrase must not be empty." });
  }
  const confirmation = yield* promptPassword("Confirm new passphrase:");
  if (first !== confirmation) {
    return yield* new IdentityError({ message: "Passphrases did not match." });
  }
  return first;
});

const changeHandler = Effect.fn(
  function* () {
    const api = yield* apiClient;
    const oldPassphrase = yield* promptPassword("Current passphrase:");
    const newPassphrase = yield* promptNewPassphrase;
    const { account } = yield* changePassphrase(api, { oldPassphrase, newPassphrase });
    yield* printHuman(ACCOUNT_OUTCOME_MESSAGE[account]);
    return { changed: true, account };
  },
  runCommand({ json: "value" }),
);

const changeCommand = Command.make("change", {}, changeHandler).pipe(
  Command.withDescription(
    "Change this device's passphrase, re-sealing the device identity and (if enrolled) your account key under it",
  ),
);

export const passphraseCommand = Command.make("passphrase", {}, changeHandler).pipe(
  Command.withDescription("Manage this device's identity passphrase"),
  Command.withSubcommands([changeCommand]),
);
