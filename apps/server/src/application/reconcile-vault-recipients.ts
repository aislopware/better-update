import { Effect } from "effect";

import { resolveEffectiveStatements } from "../auth/middleware";
import { roleIsOwner } from "../auth/owner";
import { isAllowed } from "../auth/policy-match";
import { roleIsSuperadmin } from "../auth/superadmin";
import { MemberRepo } from "../repositories/member-repo";
import { OrgVaultRepo } from "../repositories/org-vault";
import { UserEncryptionKeyRepo } from "../repositories/user-encryption-keys";

// Mirror the request-time gate (auth/policy.ts assertAccess): owner + superadmin
// bypass; otherwise effective statements must allow `vaultAccess:read`. Resolved
// off-request from the persisted policies/groups, so it reflects the live state
// after the IAM mutation that triggered the reconcile.
const userStillHasVaultAccess = (params: {
  readonly organizationId: string;
  readonly userId: string;
}) =>
  Effect.gen(function* () {
    const memberRepo = yield* MemberRepo;
    const auth = yield* memberRepo.findAuthRoleByUser(params);
    // No longer a member of the org → no vault access.
    if (auth === null) {
      return false;
    }
    if (roleIsOwner(auth.memberRole) || roleIsSuperadmin(auth.userRole)) {
      return true;
    }
    const statements = yield* resolveEffectiveStatements({
      organizationId: params.organizationId,
      memberId: auth.memberId,
    });
    return isAllowed(statements, "vaultAccess:read", "org");
  });

/**
 * One authoritative pass binding the IAM access lifecycle to the vault recipient
 * set. For every device key currently wrapped at the live vault version, if its
 * owner no longer holds `vaultAccess:read` (removed from the org, or downgraded),
 * drop their wrap, flag the vault for rotation, and revoke the key on its last
 * org — via the same `dropDeviceWrapsForUser` the removal path uses.
 *
 * Fire it after ANY IAM change that can strip access (policy detach, group
 * membership/policy change, policy edit/delete) instead of diffing each site:
 * a whole-org reconcile converges even when one edit strips access from many
 * members at once. Org-owned recovery/machine recipients are never touched.
 * Returns the dropped user ids. See docs/specs/build/10-vault-lifecycle-revocation.md §3.6.
 */
export const reconcileVaultRecipients = (params: {
  readonly organizationId: string;
  readonly reason: string;
}) =>
  Effect.gen(function* () {
    const orgVault = yield* OrgVaultRepo;
    const vault = yield* orgVault.getVault({ organizationId: params.organizationId });
    if (vault === null) {
      return [] as readonly string[];
    }

    const keyRepo = yield* UserEncryptionKeyRepo;
    const wraps = yield* orgVault.listWraps({
      organizationId: params.organizationId,
      vaultVersion: vault.vaultVersion,
    });
    const keys = yield* Effect.forEach(
      wraps,
      (wrap) => keyRepo.findById({ id: wrap.userEncryptionKeyId }),
      { concurrency: "unbounded" },
    );
    // Only device keys are user-scoped recipients; recovery/machine keys are
    // org-owned and managed only via explicit rotate/revoke.
    const recipientUserIds = [
      ...new Set(
        keys.flatMap((key) => (key.kind === "device" && key.userId !== null ? [key.userId] : [])),
      ),
    ];

    const now = new Date().toISOString();
    const outcomes = yield* Effect.forEach(
      recipientUserIds,
      (userId) =>
        Effect.gen(function* () {
          const stillHasAccess = yield* userStillHasVaultAccess({
            organizationId: params.organizationId,
            userId,
          });
          if (stillHasAccess) {
            return null;
          }
          const droppedKeys = yield* orgVault.dropDeviceWrapsForUser({
            organizationId: params.organizationId,
            userId,
            reason: params.reason,
            now,
          });
          return droppedKeys.length > 0 ? userId : null;
        }),
      // Sequential: each drop mutates the same vault row + rotation-pending flag.
      { concurrency: 1 },
    );
    return outcomes.filter((userId): userId is string => userId !== null);
  });
