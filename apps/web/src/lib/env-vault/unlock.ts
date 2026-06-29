import { getTypedApiError } from "@better-update/api-client";
import { getAccountKeyEscrow, getEnvVaultAccountWrap } from "@better-update/api-client/react";
import { openAccountKey, unwrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64 } from "@better-update/encoding";

import { cacheEnvVaultKey, readCachedEnvVaultKey } from "./cache";
import { escrowToEnvelope } from "./crypto";

import type { UnlockedEnvVault } from "./cache";

export type { UnlockedEnvVault } from "./cache";

// The account key and its env-vault wrap are CLI-only — the browser can read
// them but never create them. A server `NotFound` here therefore means a setup
// step is missing, so remap it to the exact CLI command that fixes it (the raw
// "No account key registered for this user" is opaque to a web user).
const ACCOUNT_KEY_MISSING_HINT =
  "No account key is enrolled for your user yet. Enroll one from the CLI, then try again: " +
  "better-update credentials account create";
const ENV_WRAP_MISSING_HINT =
  "Your account key can't open this organization's env vault yet. Ask an admin to run " +
  "`better-update credentials env-vault migrate`, or run `better-update credentials account link` " +
  "if the vault was rotated.";

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
 * Unlock the org's env vault in the browser:
 *   1. download the caller's passphrase-sealed account-key escrow (server-gated on
 *      a fresh WebAuthn step-up — call `stepUpPasskey` first),
 *   2. open it locally with the passphrase → the account's age private key,
 *   3. download the env-vault key wrapped to that account key and unwrap it.
 * The unwrapped key is cached in sessionStorage for the rest of the session.
 * Throws on a wrong passphrase (the escrow AEAD tag fails); a server `NotFound` at
 * step 1 (no account key) or step 3 (no env-vault wrap) is remapped to an
 * actionable message naming the CLI command that fixes it.
 */
export const unlockEnvVault = async (
  orgId: string,
  passphrase: string,
): Promise<UnlockedEnvVault> => {
  const escrow = await orNotFoundHint(getAccountKeyEscrow(), ACCOUNT_KEY_MISSING_HINT);
  const material = await openAccountKey({ envelope: escrowToEnvelope(escrow), passphrase });
  const wrap = await orNotFoundHint(getEnvVaultAccountWrap(escrow.id), ENV_WRAP_MISSING_HINT);
  const vaultKey = await unwrapVaultKey({
    wrapped: fromBase64(wrap.wrappedKey),
    privateKey: material.agePrivateKey,
  });
  const unlocked: UnlockedEnvVault = { vaultKey, envVaultVersion: wrap.envVaultVersion };
  cacheEnvVaultKey(orgId, unlocked);
  return unlocked;
};

/** The cached unlocked vault for this org, or `null` if it has not been unlocked this session. */
export const getUnlockedEnvVault = (orgId: string): UnlockedEnvVault | null =>
  readCachedEnvVaultKey(orgId);
