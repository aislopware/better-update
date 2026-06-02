import { Effect } from "effect";

import type { UserEncryptionKey } from "@better-update/api";

import { unlockVaultKeyInteractive } from "../../application/vault-access";
import { IdentityError } from "../../lib/exit-codes";
import { printKeyValue } from "../../lib/output";
import { promptConfirm, promptText } from "../../lib/prompts";

import type { ApiClient } from "../../services/api-client";

/**
 * Unlock the vault key for an interactive command: reuse the OS-keychain-cached
 * key when live, prompt for the device passphrase only on a cache miss, and none
 * at all for the CI `BETTER_UPDATE_IDENTITY` env key.
 */
export const unlockVaultInteractively = (api: ApiClient) => unlockVaultKeyInteractive(api);

/** Resolve a recipient selector (key id or fingerprint) from a flag, prompting if absent. */
export const resolveSelector = (flag: string | undefined, message: string) =>
  Effect.gen(function* () {
    if (flag && flag.trim().length > 0) {
      return flag.trim();
    }
    return yield* promptText(message);
  });

/**
 * Show a target recipient's fingerprint and require explicit out-of-band
 * confirmation before wrapping the vault key to it — the trust-on-first-use
 * verification that stops a swapped public key from silently gaining access.
 * `--yes` skips it for scripted grants that already pass the exact fingerprint.
 */
export const confirmFingerprint = (target: UserEncryptionKey, skip: boolean) =>
  Effect.gen(function* () {
    yield* printKeyValue([
      ["Label", target.label],
      ["Kind", target.kind],
      ["Recipient (public key)", target.publicKey],
      ["Fingerprint", target.fingerprint],
    ]);
    if (skip) {
      return undefined;
    }
    const verified = yield* promptConfirm(
      "Have you verified this fingerprint out-of-band with the recipient?",
      { initialValue: false },
    );
    if (!verified) {
      return yield* new IdentityError({
        message: "Cancelled — verify the recipient fingerprint out-of-band first.",
      });
    }
    return undefined;
  });
