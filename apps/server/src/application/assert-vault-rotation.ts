import { Effect } from "effect";

import { Conflict } from "../errors";
import { OrgVaultRepo } from "../repositories/org-vault";

/** Shared message so the CLI/dashboard can recognise the pending-rotation block. */
export const VAULT_ROTATION_PENDING_MESSAGE =
  "Vault rotation pending — a recipient was removed; an admin must rotate the vault " +
  "(`credentials access rotate`) before credentials can be read.";

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
