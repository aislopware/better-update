import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { Conflict, NotFound } from "../errors";
import { toApiCrudEffect } from "../http/to-api-effect";
import { MemberRepo } from "../repositories/member-repo";
import { OrgVaultRepo } from "../repositories/org-vault";

export const MembersGroupLive = HttpApiBuilder.group(ManagementApi, "members", (handlers) =>
  handlers.handle("remove", ({ path }) =>
    toApiCrudEffect(
      Effect.gen(function* () {
        yield* assertAccess("member", "delete");
        const ctx = yield* CurrentActor;
        const repo = yield* MemberRepo;

        // Load org-scoped: a member absent in this org is NotFound (never a
        // cross-org delete, mirroring api-keys.revoke / invitations.cancel).
        const target = yield* repo.findInOrg({
          id: path.id,
          organizationId: ctx.organizationId,
        });
        if (target === null) {
          return yield* new NotFound({ message: "Member not found" });
        }

        // Last-owner guard. Ownership TRANSFER is out of scope for this slice
        // (owner is set once at org creation), but the `countOwners <= 1` framing
        // keeps the guard forward-compatible: a future transfer flow that creates
        // a second owner could still remove a redundant one, while the sole owner
        // can never be removed (which would orphan the org's root principal).
        if (target.role === "owner") {
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
