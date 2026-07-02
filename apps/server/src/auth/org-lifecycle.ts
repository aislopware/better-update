// Organization-lifecycle side effects wired into Better Auth's
// `organizationHooks` (auth.ts). These run inside plugin routes (org create,
// invitation accept/reject/cancel) — outside the Effect HttpApi layers — so
// they speak raw D1, mirroring auth/memberships.ts.

// New orgs are born with `production` protected
// (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §2d; existing orgs were seeded
// by migration 0081).
export const seedProtectedEnvironments = async (
  db: D1Database,
  organizationId: string,
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO "protected_environment" ("organization_id", "environment")
       VALUES (?, 'production')
       ON CONFLICT ("organization_id", "environment") DO NOTHING`,
    )
    .bind(organizationId)
    .run();
};

// Apply the access grants an invitation carries (SPEC §8d): each grant was
// validated + boundary-checked against the INVITER when the invitation was
// created, so accept just materializes them as policy attachments on the new
// member and consumes the rows. One D1 batch keeps apply+sweep atomic.
export const applyInvitationGrants = async (
  db: D1Database,
  params: {
    readonly invitationId: string;
    readonly organizationId: string;
    readonly memberId: string;
    readonly actorEmail: string;
  },
): Promise<void> => {
  const grants = await db
    .prepare(
      `SELECT "policy_id" FROM "invitation_grant"
       WHERE "invitation_id" = ? AND "organization_id" = ?`,
    )
    .bind(params.invitationId, params.organizationId)
    .all<{ policy_id: string }>();
  const policyIds = grants.results.map((row) => row.policy_id);
  const sweep = db
    .prepare(`DELETE FROM "invitation_grant" WHERE "invitation_id" = ?`)
    .bind(params.invitationId);
  if (policyIds.length === 0) {
    await sweep.run();
    return;
  }
  const now = new Date().toISOString();
  await db.batch([
    ...policyIds.map((policyId) =>
      db
        .prepare(
          `INSERT INTO "policy_attachment"
             ("id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at")
           VALUES (?, ?, ?, 'member', ?, ?)
           ON CONFLICT ("organization_id", "policy_id", "principal_type", "principal_id") DO NOTHING`,
        )
        .bind(crypto.randomUUID(), params.organizationId, policyId, params.memberId, now),
    ),
    db
      .prepare(
        `INSERT INTO "audit_logs"
           ("id", "organization_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source")
         VALUES (?, ?, NULL, ?, 'member.grants_applied', 'policyAttachment', ?, ?, 'session')`,
      )
      .bind(
        crypto.randomUUID(),
        params.organizationId,
        params.actorEmail,
        params.memberId,
        JSON.stringify({ invitationId: params.invitationId, policyIds }),
      ),
    sweep,
  ]);
};

// Grants die with their invitation — swept on cancel/reject so a re-used
// invitation id can never resurrect stale access.
export const sweepInvitationGrants = async (
  db: D1Database,
  invitationId: string,
): Promise<void> => {
  await db
    .prepare(`DELETE FROM "invitation_grant" WHERE "invitation_id" = ?`)
    .bind(invitationId)
    .run();
};
