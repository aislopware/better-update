import { Effect } from "effect";

import { Conflict } from "../errors";
import { OrgVaultRepo } from "../repositories/org-vault";

/**
 * Reject a credential upload whose DEK was wrapped under a stale vault version.
 * The client unlocks the vault — and wraps the DEK — at the version it last saw;
 * if an admin rotates the vault in between, accepting the upload would persist a
 * credential bound to a now-discarded key version: undecryptable forever, and a
 * blocker for the next rotation (which re-wraps every DEK and cannot unwrap one
 * sealed under a key it no longer holds). The client must re-unlock at the
 * current version and re-encrypt, so we surface a `Conflict` to drive that.
 */
export const assertVaultVersionCurrent = (params: {
  readonly organizationId: string;
  readonly vaultVersion: number;
}): Effect.Effect<void, Conflict, OrgVaultRepo> =>
  Effect.gen(function* () {
    const orgVault = yield* OrgVaultRepo;
    const vault = yield* orgVault.getVault({ organizationId: params.organizationId });
    // Reject only when a vault exists and the client sealed against a different
    // version — exactly the rotation race, since a rotation always operates on an
    // existing vault. An org with no vault yet has no rotation to be stale against
    // (and a credential can't be sealed without one), so the absence is not gated.
    if (vault !== null && vault.vaultVersion !== params.vaultVersion) {
      return yield* Effect.fail(
        new Conflict({
          message:
            "Vault version is out of date — the vault was rotated. Re-unlock the vault and upload this credential again.",
        }),
      );
    }
    return undefined;
  });
