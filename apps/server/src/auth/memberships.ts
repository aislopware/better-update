export const findFirstMembershipOrgId = async (
  db: D1Database,
  userId: string,
): Promise<string | null> => {
  const row = await db
    .prepare(
      "SELECT organization_id FROM member WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1",
    )
    .bind(userId)
    .first<{ organization_id: string }>();
  if (row === null) {
    return null;
  }
  return row.organization_id;
};
