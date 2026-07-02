import { Group, GroupMember } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertAccess } from "../auth/policy";
import { isWithinBoundary } from "../auth/policy-boundary";
import { statementsForPrincipals } from "../auth/statements";
import { Forbidden, NotFound } from "../errors";
import { toApiWriteEffect } from "../http/to-api-effect";
import { toDbNull } from "../lib/nullable";
import { GroupRepo } from "../repositories/group-repo";
import { MemberRepo } from "../repositories/member-repo";
import { reconcileVaultAccess } from "./reconcile-vault-access";

import type { GroupModel } from "../models";

const toApiGroup = (model: GroupModel) =>
  new Group({
    id: model.id,
    organizationId: model.organizationId,
    name: model.name,
    description: model.description,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

// Permission boundary (no privilege escalation): a group's members inherit
// every policy attached to that group (auth/middleware.ts resolveEffectiveStatements),
// exactly like a direct policy attachment. So changing a group's roster is a
// grant/revoke of the group's full statement set — it must clear the same
// boundary check `attachPolicy` and robot bearer-rotation enforce. Otherwise a
// bare `group:update` token would be a ladder into any group holding
// `managed:admin`. Owners/superadmins bypass (root / cross-org).
const assertGroupWithinBoundary = (groupId: string) =>
  Effect.gen(function* () {
    const ctx = yield* CurrentActor;
    if (ctx.isOwner || ctx.isSuperadmin) {
      return;
    }
    const granted = yield* statementsForPrincipals({
      organizationId: ctx.organizationId,
      principals: [{ type: "group", id: groupId }],
    });
    if (!isWithinBoundary(ctx.effectiveStatements, { statements: granted })) {
      return yield* new Forbidden({
        message: "Cannot change membership of a group that grants more than you currently hold",
      });
    }
  });

export const GroupsGroupLive = HttpApiBuilder.group(ManagementApi, "groups", (handlers) =>
  handlers
    .handle("list", () =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const groups = yield* repo.list({ organizationId: ctx.organizationId });
          return { items: groups.map(toApiGroup) };
        }),
      ),
    )
    .handle("create", ({ payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const created = yield* repo.create({
            organizationId: ctx.organizationId,
            name: payload.name,
            description: toDbNull(payload.description),
          });
          yield* logAudit({
            action: "group.create",
            resourceType: "group",
            resourceId: created.id,
            metadata: { name: created.name },
          });
          return toApiGroup(created);
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const group = yield* repo.findById({ id: path.id, organizationId: ctx.organizationId });
          if (group === null) {
            return yield* new NotFound({ message: "Group not found" });
          }
          return toApiGroup(group);
        }),
      ),
    )
    .handle("update", ({ path, payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "update");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const updated = yield* repo.update({
            id: path.id,
            organizationId: ctx.organizationId,
            ...(payload.name === undefined ? {} : { name: payload.name }),
            ...(payload.description === undefined ? {} : { description: payload.description }),
          });
          if (updated === null) {
            return yield* new NotFound({ message: "Group not found" });
          }
          yield* logAudit({
            action: "group.update",
            resourceType: "group",
            resourceId: path.id,
          });
          return toApiGroup(updated);
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "delete");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const deleted = yield* repo.delete({ id: path.id, organizationId: ctx.organizationId });
          if (!deleted) {
            return yield* new NotFound({ message: "Group not found" });
          }
          yield* logAudit({
            action: "group.delete",
            resourceType: "group",
            resourceId: path.id,
          });
          // The cascade drops the group's policy attachments, so members of the
          // group may lose `vaultAccess` — reconcile the recipient set.
          yield* reconcileVaultAccess({
            organizationId: ctx.organizationId,
            reason: `group-deleted:${path.id}`,
          });
          return { deleted: 1 };
        }),
      ),
    )
    .handle("listMembers", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const group = yield* repo.findById({ id: path.id, organizationId: ctx.organizationId });
          if (group === null) {
            return yield* new NotFound({ message: "Group not found" });
          }
          const members = yield* repo.listMembers({ groupId: path.id });
          return {
            items: members.map(
              (member) =>
                new GroupMember({ memberId: member.memberId, createdAt: member.createdAt }),
            ),
          };
        }),
      ),
    )
    .handle("addMember", ({ path, payload }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "update");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const memberRepo = yield* MemberRepo;
          const group = yield* repo.findById({ id: path.id, organizationId: ctx.organizationId });
          if (group === null) {
            return yield* new NotFound({ message: "Group not found" });
          }
          const memberOrgId = yield* memberRepo.findOrgId({ memberId: payload.memberId });
          if (memberOrgId !== ctx.organizationId) {
            return yield* new NotFound({ message: "Member not found" });
          }
          yield* assertGroupWithinBoundary(path.id);
          yield* repo.addMember({ groupId: path.id, memberId: payload.memberId });
          const now = new Date().toISOString();
          yield* logAudit({
            action: "group.addMember",
            resourceType: "group",
            resourceId: path.id,
            metadata: { memberId: payload.memberId },
          });
          return new GroupMember({ memberId: payload.memberId, createdAt: now });
        }),
      ),
    )
    .handle("removeMember", ({ path }) =>
      toApiWriteEffect(
        Effect.gen(function* () {
          yield* assertAccess("group", "update");
          const ctx = yield* CurrentActor;
          const repo = yield* GroupRepo;
          const group = yield* repo.findById({ id: path.id, organizationId: ctx.organizationId });
          if (group === null) {
            return yield* new NotFound({ message: "Group not found" });
          }
          yield* assertGroupWithinBoundary(path.id);
          yield* repo.removeMember({ groupId: path.id, memberId: path.memberId });
          yield* logAudit({
            action: "group.removeMember",
            resourceType: "group",
            resourceId: path.id,
            metadata: { memberId: path.memberId },
          });
          // Leaving the group drops the member's inherited policies, which may
          // include `vaultAccess` — reconcile the recipient set.
          yield* reconcileVaultAccess({
            organizationId: ctx.organizationId,
            reason: `group-member-removed:${path.memberId}`,
          });
          return { deleted: 1 };
        }),
      ),
    ),
);
