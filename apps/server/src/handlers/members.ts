import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { Conflict, Forbidden, NotFound } from "../errors";
import { toApiCrudEffect } from "../http/to-api-effect";
import { MemberRepo } from "../repositories/member-repo";
import { OrgVaultRepo } from "../repositories/org-vault";
import { ProjectMemberRepo } from "../repositories/project-members";
import { reconcileVaultAccess } from "./reconcile-vault-access";

export const MembersGroupLive = HttpApiBuilder.group(ManagementApi, "members", (handlers) =>
  handlers
    .handle("updateRole", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertAccess("member", "update");
          const ctx = yield* CurrentActor;

          // Granting OR revoking admin changes who administers the org — an
          // owner-only decision (GITLAB-RBAC-SPEC §2, second table). Admins
          // may not mint or depose other admins.
          if (!ctx.isOwner && !ctx.isSuperadmin) {
            return yield* new Forbidden({
              message: "Only an owner can grant or revoke the admin role",
            });
          }

          const repo = yield* MemberRepo;
          const target = yield* repo.findInOrg({
            id: path.id,
            organizationId: ctx.organizationId,
          });
          if (target === null) {
            return yield* new NotFound({ message: "Member not found" });
          }
          if (target.role === "owner") {
            return yield* new Conflict({
              message: "The owner role cannot be changed (org root, set at creation)",
            });
          }

          yield* repo.updateRole({
            id: path.id,
            organizationId: ctx.organizationId,
            role: payload.role,
          });

          yield* logAudit({
            action: "member.role_update",
            resourceType: "member",
            resourceId: path.id,
            metadata: { from: target.role, to: payload.role },
          });

          // Demoting an admin strips vaultAccess:read (org-admin rule) — bind
          // the change to the vault recipient set so their device wraps drop
          // and the vault flags for rotation (vault-lifecycle-revocation §3.6).
          if (payload.role === "member") {
            yield* reconcileVaultAccess({
              organizationId: ctx.organizationId,
              reason: `member-role-change:${path.id}`,
            });
          }

          return { id: path.id, role: payload.role };
        }),
      ),
    )
    .handle("remove", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertAccess("member", "delete");
          const ctx = yield* CurrentActor;
          const repo = yield* MemberRepo;

          // Load org-scoped: a member absent in this org is NotFound (never a
          // cross-org delete, mirroring robot-accounts.revoke / invitations.cancel).
          const target = yield* repo.findInOrg({
            id: path.id,
            organizationId: ctx.organizationId,
          });
          if (target === null) {
            return yield* new NotFound({ message: "Member not found" });
          }

          // Removing an owner is an action against the org's root principal, so only
          // an owner (or superadmin) may do it — a non-owner holding `member:delete`
          // must not be able to depose an owner (a de-escalation/sabotage vector).
          // Then the last-owner guard: ownership TRANSFER is out of scope (owner is
          // set once at org creation), but the `countOwners <= 1` framing stays
          // forward-compatible — a future transfer flow that creates a second owner
          // could remove a redundant one, while the sole owner can never be removed.
          if (target.role === "owner") {
            if (!ctx.isOwner && !ctx.isSuperadmin) {
              return yield* new Forbidden({ message: "Only an owner can remove an owner" });
            }
            const owners = yield* repo.countOwners({ organizationId: ctx.organizationId });
            if (owners <= 1) {
              return yield* new Conflict({ message: "Cannot remove the last owner" });
            }
          }

          yield* repo.remove({ id: path.id, organizationId: ctx.organizationId });

          // Membership rows die with the member (GITLAB-RBAC-SPEC §4a).
          const projectMembers = yield* ProjectMemberRepo;
          yield* projectMembers.removeAllForPrincipal({
            organizationId: ctx.organizationId,
            principalType: "member",
            principalId: path.id,
          });

          yield* logAudit({
            action: "member.delete",
            resourceType: "member",
            resourceId: path.id,
          });

          // Bind the departure to the vault: drop the removed member's device wraps
          // in this org and flag the vault for rotation. Their cached vault key still
          // matches the live vault until an admin rotates, so credential-download
          // paths fail closed until then (see vault-lifecycle-revocation §3).
          const vaultRepo = yield* OrgVaultRepo;
          const droppedRecipients = yield* vaultRepo.dropDeviceWrapsForUser({
            organizationId: ctx.organizationId,
            userId: target.userId,
            reason: `member-removed:${target.userId}`,
            now: new Date().toISOString(),
          });
          if (droppedRecipients.length > 0) {
            yield* logAudit({
              action: "vault.recipient.dropped",
              resourceType: "vaultAccess",
              resourceId: ctx.organizationId,
              metadata: {
                reason: "member-removed",
                userId: target.userId,
                droppedRecipients,
                rotationPending: true,
              },
            });
          }

          return { deleted: 1 };
        }),
      ),
    ),
);
