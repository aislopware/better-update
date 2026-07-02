import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { roleIsOwner } from "../auth/owner";
import { assertAccess } from "../auth/policy";
import { Conflict, Forbidden, NotFound } from "../errors";
import { toApiCrudEffect, toApiForbiddenEffect } from "../http/to-api-effect";
import { computeAccessSummaries } from "../lib/access-summary";
import { GroupRepo } from "../repositories/group-repo";
import { MemberRepo } from "../repositories/member-repo";
import { OrgVaultRepo } from "../repositories/org-vault";
import { PolicyAttachmentRepo } from "../repositories/policy-attachment-repo";

// Server-computed Access chips for the Members table (SPEC §9a): members +
// group memberships + ALL org attachments in three small reads, combined in
// memory (orgs cap at 100 members) — never an N+1 per row.
const accessSummariesHandler = () =>
  toApiForbiddenEffect(
    Effect.gen(function* () {
      yield* assertAccess("policy", "read");
      const ctx = yield* CurrentActor;
      const memberRepo = yield* MemberRepo;
      const groupRepo = yield* GroupRepo;
      const attachmentRepo = yield* PolicyAttachmentRepo;
      const [members, memberships, attachments] = yield* Effect.all([
        memberRepo.listByOrg({ organizationId: ctx.organizationId }),
        groupRepo.listMembershipsByOrg({ organizationId: ctx.organizationId }),
        attachmentRepo.listByOrg({ organizationId: ctx.organizationId }),
      ]);
      return {
        items: computeAccessSummaries({
          members: members.map((member) => ({
            id: member.id,
            isOwner: roleIsOwner(member.role),
          })),
          memberships,
          attachments,
        }),
      };
    }),
  );

export const MembersGroupLive = HttpApiBuilder.group(ManagementApi, "members", (handlers) =>
  handlers.handle("accessSummaries", accessSummariesHandler).handle("remove", ({ path }) =>
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
        // must not be able to depose an owner (a de-escalation/sabotage vector,
        // same class as the group/detach boundary guards). Then the last-owner
        // guard: ownership TRANSFER is out of scope (owner is set once at org
        // creation), but the `countOwners <= 1` framing stays forward-compatible —
        // a future transfer flow that creates a second owner could remove a
        // redundant one, while the sole owner can never be removed.
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
