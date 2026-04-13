export const CHANNEL_BRANCH_REFERENCE_PREDICATE = `
  "branch_id" = ?
  OR (
    "branch_mapping_json" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM json_each("branch_mapping_json", '$.data') AS "branch_mapping_entry"
      WHERE json_extract("branch_mapping_entry"."value", '$.branchId') = ?
    )
  )
`;

export const bumpChannelCacheVersionByBranchReference = async (
  db: D1Database,
  branchId: string,
): Promise<void> => {
  await db
    .prepare(
      `UPDATE "channels" SET "cache_version" = "cache_version" + 1 WHERE ${CHANNEL_BRANCH_REFERENCE_PREDICATE}`,
    )
    .bind(branchId, branchId)
    .run();
};
