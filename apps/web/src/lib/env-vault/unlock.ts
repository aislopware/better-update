import { getTypedApiError } from "@better-update/api-client";
import { getAccountKeyEscrow, getEnvVaultAccountWrap } from "@better-update/api-client/react";
import { openAccountKey, unwrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64 } from "@better-update/encoding";

import { cacheEnvVaultKey, readCachedEnvVaultKey } from "./cache";
import { escrowToEnvelope } from "./crypto";

import type { UnlockedEnvVault } from "./cache";

export type { UnlockedEnvVault } from "./cache";

// Defensive fallbacks for a server `NotFound` during unlock. The locked-state UI
// (VaultSetupActions) branches on these conditions BEFORE unlock, so these are
// rarely hit — keep them actionable but not CLI-specific (both setup steps now
// have a browser path: self-enroll an account key, then an admin grants access).
const ACCOUNT_KEY_MISSING_HINT =
  "No account key is enrolled for your user yet. Set up vault access first, then try again.";
const ENV_WRAP_MISSING_HINT =
  "Your account key can't open this organization's env vault yet. Ask an admin to grant you " +
  "env-vault access (Vault access page), then try again.";
const WRONG_PASSPHRASE_HINT =
  "Wrong passphrase — it must be the one you chose when setting up vault access. Check for " +
  "typos and try again.";
const STALE_WRAP_HINT =
  "Your account key could not open the env vault — its access may have been revoked or the " +
  "vault rotated since. Ask an admin to re-grant env access (Vault access page).";

/** Run `promise`, turning a typed `NotFound` rejection into an actionable CLI hint. */
const orNotFoundHint = async <T>(promise: Promise<T>, hint: string): Promise<T> => {
  // eslint-disable-next-line functional/no-try-statements -- remap a typed API NotFound into an actionable message; the unlock flow signals failure by rejecting
  try {
    return await promise;
  } catch (error: unknown) {
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- rejection is the unlock flow's failure channel; remap NotFound to a CLI hint surfaced by useApiMutation's toast
    throw getTypedApiError(error)?._tag === "NotFound" ? new Error(hint) : error;
  }
};

/**
 * Run a local decryption step, remapping ANY rejection to `hint`. The underlying
 * failure is always a bare AEAD error (e.g. "invalid tag" when a wrong passphrase
 * derives a wrong key) — useless in a toast, so replace it wholesale.
 */
const orDecryptHint = async <T>(promise: Promise<T>, hint: string): Promise<T> => {
  // eslint-disable-next-line functional/no-try-statements -- remap the raw AEAD error into an actionable message; the unlock flow signals failure by rejecting
  try {
    return await promise;
  } catch {
    // eslint-disable-next-line functional/no-throw-statements, functional/no-promise-reject -- rejection is the unlock flow's failure channel; replace the raw AEAD error with an actionable message
    throw new Error(hint);
  }
};

/**
 * Unlock the org's env vault in the browser:
 *   1. download the caller's passphrase-sealed account-key escrow (server-gated on
 *      a fresh WebAuthn step-up — call `stepUpPasskey` first),
 *   2. open it locally with the passphrase → the account's age private key,
 *   3. download the env-vault key wrapped to that account key and unwrap it.
 * The unwrapped key is cached in sessionStorage for the rest of the session.
 * Every failure mode is remapped to an actionable message: a server `NotFound` at
 * step 1 (no account key) or step 3 (no env-vault wrap) names the setup step that
 * fixes it, and a local AEAD failure at step 2 (wrong passphrase) or step 4 (a
 * wrap the key can no longer open) explains itself instead of leaking the raw
 * "invalid tag" crypto error.
 */
export const unlockEnvVault = async (
  orgId: string,
  passphrase: string,
): Promise<UnlockedEnvVault> => {
  const escrow = await orNotFoundHint(getAccountKeyEscrow(), ACCOUNT_KEY_MISSING_HINT);
  const material = await orDecryptHint(
    openAccountKey({ envelope: escrowToEnvelope(escrow), passphrase }),
    WRONG_PASSPHRASE_HINT,
  );
  const wrap = await orNotFoundHint(getEnvVaultAccountWrap(escrow.id), ENV_WRAP_MISSING_HINT);
  const vaultKey = await orDecryptHint(
    unwrapVaultKey({
      wrapped: fromBase64(wrap.wrappedKey),
      privateKey: material.agePrivateKey,
    }),
    STALE_WRAP_HINT,
  );
  const unlocked: UnlockedEnvVault = { vaultKey, envVaultVersion: wrap.envVaultVersion };
  cacheEnvVaultKey(orgId, unlocked);
  return unlocked;
};

/** The cached unlocked vault for this org, or `null` if it has not been unlocked this session. */
export const getUnlockedEnvVault = (orgId: string): UnlockedEnvVault | null =>
  readCachedEnvVaultKey(orgId);
