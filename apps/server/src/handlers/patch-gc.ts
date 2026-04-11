const BATCH_SIZE = 100;

interface ExpiredPatch {
  old_asset_hash: string;
  new_asset_hash: string;
  r2_key: string;
}

const parseRetentionDays = (raw: string | undefined) => Number.parseInt(raw ?? "30", 10);

const computeCutoff = (retentionDays: number) =>
  new Date(Date.now() - retentionDays * 86_400_000).toISOString();

const fetchExpiredBatch = async (env: Env, cutoff: string) => {
  const { results } = await env.DB.prepare(
    `SELECT "old_asset_hash", "new_asset_hash", "r2_key" FROM "patches" WHERE "created_at" < ? LIMIT ?`,
  )
    .bind(cutoff, BATCH_SIZE)
    .all<ExpiredPatch>();
  return results;
};

const deleteBatch = async (env: Env, batch: readonly ExpiredPatch[]) => {
  await env.ASSETS_BUCKET.delete(batch.map((row) => row.r2_key));
  await env.DB.batch(
    batch.map((row) =>
      env.DB.prepare(
        `DELETE FROM "patches" WHERE "old_asset_hash" = ? AND "new_asset_hash" = ?`,
      ).bind(row.old_asset_hash, row.new_asset_hash),
    ),
  );
};

const processExpiredBatches = async (
  env: Env,
  cutoff: string,
  totalDeleted: number,
): Promise<number> => {
  const batch = await fetchExpiredBatch(env, cutoff);
  if (batch.length === 0) {
    return totalDeleted;
  }

  await deleteBatch(env, batch);
  return processExpiredBatches(env, cutoff, totalDeleted + batch.length);
};

export { handlePatchMessage } from "./patch-queue";
export { serveManifest } from "./manifest";

export const handleScheduled = async (env: Env): Promise<void> => {
  const retentionDays = parseRetentionDays(env.PATCH_RETENTION_DAYS);
  const cutoff = computeCutoff(retentionDays);
  const totalDeleted = await processExpiredBatches(env, cutoff, 0);

  if (totalDeleted > 0) {
    console.info("[patch-gc] Cleaned up expired patches", { totalDeleted });
  }

  const { handleBuildGc } = await import("./build-gc");
  await handleBuildGc(env);
};
