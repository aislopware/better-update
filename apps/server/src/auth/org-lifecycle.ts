// Organization-lifecycle side effects wired into Better Auth's
// `organizationHooks` (auth.ts). These run inside plugin routes (org create,
// invitation accept/reject/cancel) — outside the Effect HttpApi layers — so
// they speak raw D1, mirroring auth/memberships.ts.

// New orgs are born with `production` protected
// (docs/specs/authz/GITLAB-RBAC-SPEC.md §3a; existing orgs were seeded by
// migration 0081).
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

// Apply the project grants an invitation carries (GITLAB-RBAC-SPEC §4c): each
// grant was validated against the INVITER when the invitation was created, so
// accept just materializes them as project_member rows on the new member and
// consumes the grant rows. One D1 batch keeps apply+sweep atomic.
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
      `SELECT "project_id", "role" FROM "invitation_project_grant"
       WHERE "invitation_id" = ? AND "organization_id" = ?`,
    )
    .bind(params.invitationId, params.organizationId)
    .all<{ project_id: string; role: string }>();
  const rows = grants.results;
  const sweep = db
    .prepare(`DELETE FROM "invitation_project_grant" WHERE "invitation_id" = ?`)
    .bind(params.invitationId);
  if (rows.length === 0) {
    await sweep.run();
    return;
  }
  const now = new Date().toISOString();
  await db.batch([
    ...rows.map((row) =>
      db
        .prepare(
          `INSERT INTO "project_member"
             ("id", "organization_id", "project_id", "principal_type", "principal_id", "role", "created_at")
           VALUES (?, ?, ?, 'member', ?, ?, ?)
           ON CONFLICT ("project_id", "principal_type", "principal_id")
           DO UPDATE SET "role" = excluded."role", "updated_at" = excluded."created_at"`,
        )
        .bind(
          crypto.randomUUID(),
          params.organizationId,
          row.project_id,
          params.memberId,
          row.role,
          now,
        ),
    ),
    db
      .prepare(
        `INSERT INTO "audit_logs"
           ("id", "organization_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source")
         VALUES (?, ?, NULL, ?, 'member.grants_applied', 'member', ?, ?, 'session')`,
      )
      .bind(
        crypto.randomUUID(),
        params.organizationId,
        params.actorEmail,
        params.memberId,
        JSON.stringify({
          invitationId: params.invitationId,
          projects: rows.map((row) => ({ projectId: row.project_id, role: row.role })),
        }),
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
    .prepare(`DELETE FROM "invitation_project_grant" WHERE "invitation_id" = ?`)
    .bind(invitationId)
    .run();
};
