import { getAccountKeyEscrow, getEnvVaultAccountWrap } from "@better-update/api-client/react";
import { openAccountKey, unwrapVaultKey } from "@better-update/credentials-crypto";
import { fromBase64 } from "@better-update/encoding";

import { cacheEnvVaultKey, readCachedEnvVaultKey } from "./cache";
import { escrowToEnvelope } from "./crypto";

import type { UnlockedEnvVault } from "./cache";

export type { UnlockedEnvVault } from "./cache";

/**
 * Unlock the org's env vault in the browser:
 *   1. download the caller's passphrase-sealed account-key escrow (server-gated on
 *      a fresh WebAuthn step-up — call `stepUpPasskey` first),
 *   2. open it locally with the passphrase → the account's age private key,
 *   3. download the env-vault key wrapped to that account key and unwrap it.
 * The unwrapped key is cached in sessionStorage for the rest of the session.
 * Throws on a wrong passphrase (the escrow AEAD tag fails) or if the caller is not
 * yet an env-vault recipient (no wrap → server NotFound).
 */
export const unlockEnvVault = async (
  orgId: string,
  passphrase: string,
): Promise<UnlockedEnvVault> => {
  const escrow = await getAccountKeyEscrow();
  const material = await openAccountKey({ envelope: escrowToEnvelope(escrow), passphrase });
  const wrap = await getEnvVaultAccountWrap(escrow.id);
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
