import { PolicyAttachment } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { resolveManagedDocument } from "../auth/managed-policies";
import { assertAccess } from "../auth/policy";
import { isWithinBoundary } from "../auth/policy-boundary";
import { Forbidden, NotFound } from "../errors";
import { toApiWriteEffect } from "../http/to-api-effect";
import { GroupRepo } from "../repositories/group-repo";
import { MemberRepo } from "../repositories/member-repo";
import { PolicyAttachmentRepo } from "../repositories/policy-attachment-repo";
import { PolicyRepo } from "../repositories/policy-repo";
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

// Confirm the principal belongs to the acting org. Members + groups are looked
// up; api-key principals are accepted (the better-auth key referenceId is the
// org, so any key id presented for the active org is in-scope).
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
    }
    // api-key principals are accepted as-is — no membership row to verify.
  });

// Resolve the document a policy id confers — a managed preset (from code) or a
// real same-org policy. Fails NotFound if the id is neither. The document drives
// both existence validation and the attach permission-boundary check.
const resolveAttachableDocument = (params: {
  readonly policyId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const managed = resolveManagedDocument(params.policyId);
    if (managed !== null) {
      return managed;
    }
    const policyRepo = yield* PolicyRepo;
    const policy = yield* policyRepo.findById({
      id: params.policyId,
      organizationId: params.organizationId,
    });
    if (policy === null) {
      return yield* new NotFound({ message: "Policy not found" });
    }
    return policy.document;
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
      const document = yield* resolveAttachableDocument({
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
        policyId: params.policyId,
        principal,
      });
      yield* logAudit({
        action: "policyAttachment.attach",
        resourceType: "policyAttachment",
        resourceId: params.policyId,
        metadata: { principalType: params.principalType, principalId: params.principalId },
      });
      const attachments = yield* repo.listForPrincipal({
        organizationId: ctx.organizationId,
        principal,
      });
      const attached = attachments.find((row) => row.policyId === params.policyId);
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
      // a group), so reconcile the vault recipient set. Api-key principals never
      // own device wraps, so they need no reconcile.
      if (params.principalType !== "apikey") {
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
      .handle("listForApiKey", ({ path }) =>
        listAttachments({ principalType: "apikey", principalId: path.id }),
      )
      .handle("attachToApiKey", ({ path, payload }) =>
        attachPolicy({ principalType: "apikey", principalId: path.id, policyId: payload.policyId }),
      )
      .handle("detachFromApiKey", ({ path }) =>
        detachPolicy({ principalType: "apikey", principalId: path.id, policyId: path.policyId }),
      ),
);
