import { Effect } from "effect";

import { PolicyAttachmentRepo } from "../repositories/policy-attachment-repo";
import { PolicyRepo } from "../repositories/policy-repo";
import { isManagedPolicyId, resolveManagedDocument } from "./managed-policies";

import type { PolicyStatement } from "../models";
import type { PrincipalRef } from "../repositories/policy-attachment-repo";

// Flatten the policy statements granted by a set of principals' attachments.
// Managed preset ids resolve from code (zero query); real ids resolve in one
// batched read. Shared by the member path (self + groups) and the robot path
// (self only) so both consult `policy_attachment` identically — no implicit
// baseline, no role-derived grants. Also reused by the robot bearer-rotation
// boundary check (handlers/robot-accounts.ts), which must resolve the TARGET
// robot's granted statements, not the caller's.
export const statementsForPrincipals = (params: {
  readonly organizationId: string;
  readonly principals: readonly PrincipalRef[];
}) =>
  Effect.gen(function* () {
    if (params.principals.length === 0) {
      return [] as readonly PolicyStatement[];
    }
    const attachRepo = yield* PolicyAttachmentRepo;
    const policyRepo = yield* PolicyRepo;

    const attachments = yield* attachRepo.findForPrincipals({
      organizationId: params.organizationId,
      principals: params.principals,
    });

    const policyIds = [...new Set(attachments.map((att) => att.policyId))];
    const realIds = policyIds.filter((id) => !isManagedPolicyId(id));
    const realDocs = yield* policyRepo.findDocumentsByIds({
      organizationId: params.organizationId,
      ids: realIds,
    });

    return policyIds.flatMap((id): readonly PolicyStatement[] => {
      const doc = isManagedPolicyId(id) ? resolveManagedDocument(id) : realDocs.get(id);
      return doc?.statements ?? [];
    });
  });
