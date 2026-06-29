import { Effect } from "effect";

import { Conflict } from "../errors";
import { OrgVaultRepo } from "../repositories/org-vault";
import { isEnvVaultForked } from "../vault-models";

/** Shared message so the CLI/dashboard can recognise the pending-rotation block. */
export const VAULT_ROTATION_PENDING_MESSAGE =
  "Vault rotation pending — a recipient was removed; an admin must rotate the vault " +
  "(`credentials access rotate`) before credentials can be read.";

/** Env-vault counterpart, raised once the org has cut over to a separate env vault. */
export const ENV_VAULT_ROTATION_PENDING_MESSAGE =
  "Env vault rotation pending — a recipient was removed; an admin must rotate the env " +
  "vault (`credentials env-vault rotate`) before env values can be read.";

/**
 * Fail closed on a credential-download path while the org vault is flagged for
 * rotation. A member removal/downgrade drops the departed recipient's wrap and
 * sets `rotation_pending`, but their CACHED vault key still matches the live
 * vault until it is rotated — so handing out more vault-key-encrypted ciphertext
 * (build-credentials.resolve, env-vars.export) is refused until an admin rotates,
 * which re-keys the vault and clears the flag.
 *
 * `getWrap` / `listCredentialDeks` are deliberately NOT gated — they are exactly
 * what the admin needs to read to perform that rotation; gating them would
 * deadlock the resolution.
 */
export const assertVaultRotationNotPending = (params: {
  readonly organizationId: string;
}): Effect.Effect<void, Conflict, OrgVaultRepo> =>
  Effect.gen(function* () {
    const orgVault = yield* OrgVaultRepo;
    const vault = yield* orgVault.getVault({ organizationId: params.organizationId });
    if (vault?.rotationPending === true) {
      return yield* new Conflict({ message: VAULT_ROTATION_PENDING_MESSAGE });
    }
    return undefined;
  });

/**
 * Fail closed on an env-value read path while the vault protecting env is flagged
 * for rotation. Before the org cuts over, env values live in the credentials vault
 * so its `rotation_pending` gates them (unchanged from today); after the cutover
 * they live in the env vault, gated by `env_rotation_pending`. Either way an
 * env-recipient departure no longer blocks credential/build reads.
 */
export const assertEnvVaultRotationNotPending = (params: {
  readonly organizationId: string;
}): Effect.Effect<void, Conflict, OrgVaultRepo> =>
  Effect.gen(function* () {
    const orgVault = yield* OrgVaultRepo;
    const vault = yield* orgVault.getVault({ organizationId: params.organizationId });
    if (vault === null) {
      return undefined;
    }
    const forked = isEnvVaultForked(vault);
    const blocked = forked ? vault.envRotationPending : vault.rotationPending;
    if (blocked) {
      return yield* new Conflict({
        message: forked ? ENV_VAULT_ROTATION_PENDING_MESSAGE : VAULT_ROTATION_PENDING_MESSAGE,
      });
    }
    return undefined;
  });
