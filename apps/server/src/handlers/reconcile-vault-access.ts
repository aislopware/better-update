import { Effect } from "effect";

import { reconcileVaultRecipients } from "../application/reconcile-vault-recipients";
import { logAudit } from "../audit/logger";

/**
 * Run the vault-recipient reconcile after an IAM mutation that can strip access,
 * and audit any drops. NEVER fails the caller — the mutation already succeeded, so
 * a reconcile error (or its absence) must not roll it back. Fire-and-forget from
 * the policy/group/membership write paths. See vault-lifecycle-revocation §3.6.
 */
export const reconcileVaultAccess = (params: {
  readonly organizationId: string;
  readonly reason: string;
}) =>
  reconcileVaultRecipients(params).pipe(
    Effect.flatMap((droppedUserIds) =>
      droppedUserIds.length === 0
        ? Effect.void
        : logAudit({
            action: "vault.recipient.dropped",
            resourceType: "vaultAccess",
            resourceId: params.organizationId,
            metadata: { reason: params.reason, droppedUserIds, rotationPending: true },
          }),
    ),
    Effect.catchAll(() => Effect.void),
  );
