import { Effect } from "effect";

import { toOrgRole } from "../auth/middleware";
import { roleIsOwner } from "../auth/owner";
import { isVaultParticipant } from "../auth/role-matrix";
import { roleIsSuperadmin } from "../auth/superadmin";
import { AccountKeyRepo } from "../repositories/account-keys";
import { MemberRepo } from "../repositories/member-repo";
import { OrgEnvVaultRepo } from "../repositories/org-env-vault";
import { OrgVaultRepo } from "../repositories/org-vault";
import { ProjectMemberRepo } from "../repositories/project-members";
import { UserEncryptionKeyRepo } from "../repositories/user-encryption-keys";
import { isEnvVaultForked } from "../vault-models";

/**
 * Owners of the user-scoped env-vault recipients (account keys + device keys) at
 * the current env version — the extra reconcile set once an org has cut over, so a
 * member with web-only env access (an account-key wrap but no credentials-vault
 * wrap) is still reconciled. Org-owned recovery/machine recipients are skipped.
 */
const envRecipientUserIds = (params: {
  readonly organizationId: string;
  readonly envVaultVersion: number;
}) =>
  Effect.gen(function* () {
    const envRepo = yield* OrgEnvVaultRepo;
    const keyRepo = yield* UserEncryptionKeyRepo;
    const accountRepo = yield* AccountKeyRepo;
    const wraps = yield* envRepo.listEnvWraps({
      organizationId: params.organizationId,
      envVaultVersion: params.envVaultVersion,
    });
    const ids = yield* Effect.forEach(
      wraps,
      (wrap) =>
        Effect.gen(function* () {
          if (wrap.recipientKind === "account") {
            const accountKey = yield* accountRepo
              .findById({ id: wrap.recipientId })
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            return accountKey === null ? null : accountKey.userId;
          }
          if (wrap.recipientKind === "device") {
            const key = yield* keyRepo
              .findById({ id: wrap.recipientId })
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            return key === null ? null : key.userId;
          }
          return null;
        }),
      { concurrency: "unbounded" },
    );
    return ids.filter((id): id is string => id !== null);
  });

// Mirror the request-time gate (auth/policy.ts assertVaultParticipant): owner +
// superadmin bypass; otherwise vault participation = ≥ developer on some
// project (org admins qualify via their implicit maintainer-everywhere rank).
// Resolved off-request from the persisted member + project_member rows, so it
// reflects the live state after the IAM mutation that triggered the reconcile.
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
    const orgRole = toOrgRole(auth.memberRole);
    const projectMemberRepo = yield* ProjectMemberRepo;
    const projectRoles =
      orgRole === "member"
        ? yield* projectMemberRepo.rolesForPrincipal({
            organizationId: params.organizationId,
            principalType: "member",
            principalId: auth.memberId,
          })
        : {};
    return isVaultParticipant({ orgRole, projectRoles });
  });

/**
 * One authoritative pass binding the IAM access lifecycle to the vault recipient
 * set. For every device key currently wrapped at the live vault version, if its
 * owner is no longer a vault participant (removed from the org, or left without
 * ≥ developer on any project), drop their wrap, flag the vault for rotation, and
 * revoke the key on its last org — via the same `dropDeviceWrapsForUser` the
 * removal path uses.
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
    // org-owned and managed only via explicit rotate/revoke. Once the org has cut
    // over, also include env-vault recipients (account/device) so a web-only env
    // user is reconciled even without a credentials-vault wrap.
    const envUserIds = isEnvVaultForked(vault)
      ? yield* envRecipientUserIds({
          organizationId: params.organizationId,
          envVaultVersion: vault.envVaultVersion,
        })
      : [];
    const recipientUserIds = [
      ...new Set([
        ...keys.flatMap((key) =>
          key.kind === "device" && key.userId !== null ? [key.userId] : [],
        ),
        ...envUserIds,
      ]),
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
