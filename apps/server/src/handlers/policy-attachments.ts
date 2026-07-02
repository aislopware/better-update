import { PolicyAttachment } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { MANAGED_POLICY_PREFIX, resolveManagedDocument } from "../auth/managed-policies";
import { assertAccess } from "../auth/policy";
import { isWithinBoundary } from "../auth/policy-boundary";
import { Forbidden, NotFound } from "../errors";
import { toApiWriteEffect } from "../http/to-api-effect";
import { GroupRepo } from "../repositories/group-repo";
import { MemberRepo } from "../repositories/member-repo";
import { PolicyAttachmentRepo } from "../repositories/policy-attachment-repo";
import { PolicyRepo } from "../repositories/policy-repo";
import { RobotAccountRepo } from "../repositories/robot-accounts";
import { reconcileVaultAccess } from "./reconcile-vault-access";

import type { PolicyAttachmentModel, PrincipalType } from "../models";

const toApiAttachment = (model: PolicyAttachmentModel) =>
  new PolicyAttachment({
    id: model.id,
    organizationId: model.organizationId,
    policyId: model.policyId,
    principalType: model.principalType,
    principalId: model.principalId,
    createdAt: model.createdAt,
  });

// Confirm the principal belongs to the acting org — members, groups, AND robot
// accounts are all looked up, so an attachment can never be minted against a
// nonexistent or foreign-org principal id.
const assertPrincipalInOrg = (params: {
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    if (params.principalType === "member") {
      const memberRepo = yield* MemberRepo;
      const orgId = yield* memberRepo.findOrgId({ memberId: params.principalId });
      if (orgId !== params.organizationId) {
        return yield* new NotFound({ message: "Member not found" });
      }
      return;
    }
    if (params.principalType === "group") {
      const groupRepo = yield* GroupRepo;
      const group = yield* groupRepo.findById({
        id: params.principalId,
        organizationId: params.organizationId,
      });
      if (group === null) {
        return yield* new NotFound({ message: "Group not found" });
      }
      return;
    }
    const robotRepo = yield* RobotAccountRepo;
    yield* robotRepo.findById({
      id: params.principalId,
      organizationId: params.organizationId,
    });
  });

// Validate + resolve any attachable policy id. The only managed id is
// `managed:admin`; any other `managed:*` spelling is rejected. Real ids resolve
// from the org's policy rows. The document drives the permission-boundary
// check. Shared with the invitation-grants path (handlers/invitations.ts).
export const resolveAttachablePolicy = (params: {
  readonly policyId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    if (params.policyId.startsWith(MANAGED_POLICY_PREFIX)) {
      const document = resolveManagedDocument(params.policyId);
      if (document === null) {
        return yield* new NotFound({ message: `Unknown managed policy id: ${params.policyId}` });
      }
      return { policyId: params.policyId, document };
    }
    const policyRepo = yield* PolicyRepo;
    const policy = yield* policyRepo.findById({
      id: params.policyId,
      organizationId: params.organizationId,
    });
    if (policy === null) {
      return yield* new NotFound({ message: "Policy not found" });
    }
    return { policyId: params.policyId, document: policy.document };
  });

const listAttachments = (params: {
  readonly principalType: PrincipalType;
  readonly principalId: string;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      yield* assertAccess("policy", "read");
      const ctx = yield* CurrentActor;
      yield* assertPrincipalInOrg({ ...params, organizationId: ctx.organizationId });
      const repo = yield* PolicyAttachmentRepo;
      const items = yield* repo.listForPrincipal({
        organizationId: ctx.organizationId,
        principal: { type: params.principalType, id: params.principalId },
      });
      return { items: items.map(toApiAttachment) };
    }),
  );

const attachPolicy = (params: {
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly policyId: string;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      yield* assertAccess("policy", "update");
      const ctx = yield* CurrentActor;
      yield* assertPrincipalInOrg({
        principalType: params.principalType,
        principalId: params.principalId,
        organizationId: ctx.organizationId,
      });
      const { policyId, document } = yield* resolveAttachablePolicy({
        policyId: params.policyId,
        organizationId: ctx.organizationId,
      });
      // Permission boundary (no privilege escalation): a non-owner may attach a
      // policy only if it grants nothing beyond what they themselves hold. Owners
      // and superadmins bypass (their effective set is root / cross-org).
      if (
        !ctx.isOwner &&
        !ctx.isSuperadmin &&
        !isWithinBoundary(ctx.effectiveStatements, document)
      ) {
        return yield* new Forbidden({
          message: "Cannot attach a policy that grants more than you currently hold",
        });
      }
      const repo = yield* PolicyAttachmentRepo;
      const principal = { type: params.principalType, id: params.principalId } as const;
      yield* repo.attach({
        organizationId: ctx.organizationId,
        policyId,
        principal,
      });
      yield* logAudit({
        action: "policyAttachment.attach",
        resourceType: "policyAttachment",
        resourceId: policyId,
        metadata: { principalType: params.principalType, principalId: params.principalId },
      });
      const attachments = yield* repo.listForPrincipal({
        organizationId: ctx.organizationId,
        principal,
      });
      const attached = attachments.find((row) => row.policyId === policyId);
      if (attached === undefined) {
        return yield* new NotFound({ message: "Policy attachment not found" });
      }
      return toApiAttachment(attached);
    }),
  );

const detachPolicy = (params: {
  readonly principalType: PrincipalType;
  readonly principalId: string;
  readonly policyId: string;
}) =>
  toApiWriteEffect(
    Effect.gen(function* () {
      yield* assertAccess("policy", "update");
      const ctx = yield* CurrentActor;
      yield* assertPrincipalInOrg({
        principalType: params.principalType,
        principalId: params.principalId,
        organizationId: ctx.organizationId,
      });
      // Permission boundary (no de-escalation of a stronger principal): detaching
      // is a privilege delta just like attaching. A non-owner may only strip a
      // policy that grants nothing beyond what they themselves hold — otherwise a
      // bare `policy:update` token could remove `managed:admin` from the real
      // admin. Owners/superadmins bypass (root / cross-org).
      if (!ctx.isOwner && !ctx.isSuperadmin) {
        const { document } = yield* resolveAttachablePolicy({
          policyId: params.policyId,
          organizationId: ctx.organizationId,
        });
        if (!isWithinBoundary(ctx.effectiveStatements, document)) {
          return yield* new Forbidden({
            message: "Cannot detach a policy that grants more than you currently hold",
          });
        }
      }
      const repo = yield* PolicyAttachmentRepo;
      yield* repo.detach({
        organizationId: ctx.organizationId,
        policyId: params.policyId,
        principal: { type: params.principalType, id: params.principalId },
      });
      yield* logAudit({
        action: "policyAttachment.detach",
        resourceType: "policyAttachment",
        resourceId: params.policyId,
        metadata: { principalType: params.principalType, principalId: params.principalId },
      });
      // Detaching a policy may strip `vaultAccess` from a member (directly, or via
      // a group), so reconcile the vault recipient set. Robot principals only
      // ever own a `machine`-kind wrap, which reconcile never touches (org-owned
      // recipients are managed exclusively via explicit rotate/revoke), so they
      // need no reconcile.
      if (params.principalType !== "robot") {
        yield* reconcileVaultAccess({
          organizationId: ctx.organizationId,
          reason: `policy-detached:${params.principalType}:${params.principalId}`,
        });
      }
      return { deleted: 1 };
    }),
  );

export const PolicyAttachmentsGroupLive = HttpApiBuilder.group(
  ManagementApi,
  "policy-attachments",
  (handlers) =>
    handlers
      .handle("listForMember", ({ path }) =>
        listAttachments({ principalType: "member", principalId: path.id }),
      )
      .handle("attachToMember", ({ path, payload }) =>
        attachPolicy({ principalType: "member", principalId: path.id, policyId: payload.policyId }),
      )
      .handle("detachFromMember", ({ path }) =>
        detachPolicy({ principalType: "member", principalId: path.id, policyId: path.policyId }),
      )
      .handle("listForGroup", ({ path }) =>
        listAttachments({ principalType: "group", principalId: path.id }),
      )
      .handle("attachToGroup", ({ path, payload }) =>
        attachPolicy({ principalType: "group", principalId: path.id, policyId: payload.policyId }),
      )
      .handle("detachFromGroup", ({ path }) =>
        detachPolicy({ principalType: "group", principalId: path.id, policyId: path.policyId }),
      )
      .handle("listForRobot", ({ path }) =>
        listAttachments({ principalType: "robot", principalId: path.id }),
      )
      .handle("attachToRobot", ({ path, payload }) =>
        attachPolicy({ principalType: "robot", principalId: path.id, policyId: payload.policyId }),
      )
      .handle("detachFromRobot", ({ path }) =>
        detachPolicy({ principalType: "robot", principalId: path.id, policyId: path.policyId }),
      ),
);
