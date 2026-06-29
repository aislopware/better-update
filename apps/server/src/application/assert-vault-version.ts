import { Effect } from "effect";

import { Conflict } from "../errors";
import { OrgVaultRepo } from "../repositories/org-vault";
import { isEnvVaultForked } from "../vault-models";
import { ENV_VAULT_ROTATION_PENDING_MESSAGE } from "./assert-vault-rotation";

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
      return yield* new Conflict({
        message:
          "Vault version is out of date — the vault was rotated. Re-unlock the vault and upload this credential again.",
      });
    }
    return undefined;
  });

/**
 * Guard an ENV-var value write against the vault the org's env values actually
 * live under. Three checks, in order:
 *
 * 1. **Vault-kind discriminator.** The numeric version alone CANNOT distinguish a
 *    credentials-vault seal from an env-vault seal — both version spaces start at
 *    1, so a credentials-keyed blob uploaded as version 1 would otherwise match an
 *    env vault at version 1 and be silently stored into an env row, then be
 *    permanently undecryptable (wrong key + wrong AAD). So once the org has cut
 *    over we REQUIRE `vaultKind === "env"`; an un-upgraded CLI (omits it →
 *    `"credentials"`) or one racing the cutover is rejected with a clear Conflict.
 *    Pre-cutover we reject a stray `"env"`. (`vaultKind` is optional on the wire
 *    for back-compat; absent is treated as `"credentials"`.)
 * 2. **Rotation pending (post-cutover only).** While the env vault is flagged for
 *    rotation (a recipient was removed), reject writes so no new revision lands at
 *    the about-to-be-rotated version and gets orphaned by the rotation's coverage
 *    snapshot. Pre-cutover behaviour is unchanged (writes not gated on the
 *    credentials flag — byte-identical to before the split).
 * 3. **Version freshness.** Same rotation-race reasoning as
 *    {@link assertVaultVersionCurrent}, against the live vault's version.
 */
export const assertEnvVaultWriteAllowed = (params: {
  readonly organizationId: string;
  readonly vaultVersion: number;
  readonly vaultKind?: "credentials" | "env" | undefined;
}): Effect.Effect<void, Conflict, OrgVaultRepo> =>
  Effect.gen(function* () {
    const orgVault = yield* OrgVaultRepo;
    const vault = yield* orgVault.getVault({ organizationId: params.organizationId });
    if (vault === null) {
      return undefined;
    }
    const forked = isEnvVaultForked(vault);
    if (forked) {
      if (params.vaultKind !== "env") {
        return yield* new Conflict({
          message:
            "This organization's env vault has been migrated. Upgrade the CLI and re-unlock to write env values.",
        });
      }
      if (vault.envRotationPending) {
        return yield* new Conflict({ message: ENV_VAULT_ROTATION_PENDING_MESSAGE });
      }
    } else if (params.vaultKind === "env") {
      return yield* new Conflict({
        message: "Env vault is not migrated yet — re-unlock and upload again.",
      });
    }
    const expected = forked ? vault.envVaultVersion : vault.vaultVersion;
    if (expected !== params.vaultVersion) {
      return yield* new Conflict({
        message:
          "Env vault version is out of date — the env vault was rotated or cut over. Re-unlock and upload again.",
      });
    }
    return undefined;
  });
