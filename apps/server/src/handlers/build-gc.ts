const BATCH_SIZE = 100;

const parseRetentionDays = (raw: string | undefined) => Number.parseInt(raw ?? "30", 10);

const computeCutoff = (retentionDays: number) =>
  new Date(Date.now() - retentionDays * 86_400_000).toISOString();

const fetchExpiredArtifactBatch = async (env: Env, profile: string, cutoff: string) => {
  const { results } = await env.DB.prepare(
    `SELECT b."id", a."r2_key" AS "r2_key" FROM "builds" b JOIN "build_artifacts" a ON a."build_id" = b."id" WHERE b."profile" = ? AND b."created_at" < ? LIMIT ?`,
  )
    .bind(profile, cutoff, BATCH_SIZE)
    .all<{ id: string; r2_key: string }>();
  return results;
};

const deleteArtifactBatch = async (env: Env, batch: readonly { id: string; r2_key: string }[]) => {
  await env.BUILD_BUCKET.delete(batch.map((row) => row.r2_key));
  await env.DB.batch(
    batch.map((row) =>
      env.DB.prepare(`DELETE FROM "build_artifacts" WHERE "build_id" = ?`).bind(row.id),
    ),
  );
};

const processProfileRetention = async (
  env: Env,
  profile: string,
  cutoff: string,
  totalDeleted: number,
): Promise<number> => {
  const batch = await fetchExpiredArtifactBatch(env, profile, cutoff);
  if (batch.length === 0) {
    return totalDeleted;
  }

  await deleteArtifactBatch(env, batch);
  return processProfileRetention(env, profile, cutoff, totalDeleted + batch.length);
};

const cleanupOrphanedStaging = async (env: Env): Promise<number> => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const listed = await env.BUILD_BUCKET.list({ prefix: "staging/" });
  const orphans = listed.objects.filter((obj) => obj.uploaded < twoHoursAgo);

  if (orphans.length > 0) {
    await env.BUILD_BUCKET.delete(orphans.map((obj) => obj.key));
  }

  return orphans.length;
};

const processProfiles = async (
  env: Env,
  profiles: readonly { name: string; days: number }[],
  accumulated: number,
): Promise<number> => {
  const [current, ...remaining] = profiles;
  if (!current) {
    return accumulated;
  }
  const cutoff = computeCutoff(current.days);
  const deleted = await processProfileRetention(env, current.name, cutoff, 0);
  return processProfiles(env, remaining, accumulated + deleted);
};

export const handleBuildGc = async (env: Env): Promise<void> => {
  const profiles = [
    { name: "production", days: parseRetentionDays(env.BUILD_RETENTION_PRODUCTION) },
    { name: "preview", days: parseRetentionDays(env.BUILD_RETENTION_PREVIEW) },
    { name: "development", days: parseRetentionDays(env.BUILD_RETENTION_DEVELOPMENT) },
  ];

  const totalArtifactsDeleted = await processProfiles(env, profiles, 0);
  const orphansDeleted = await cleanupOrphanedStaging(env);

  if (totalArtifactsDeleted > 0 || orphansDeleted > 0) {
    console.info("[build-gc] Cleanup complete", { totalArtifactsDeleted, orphansDeleted });
  }
};
