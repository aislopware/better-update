import { Effect } from "effect";

import { GC_BATCH_SIZE, computeCutoff, parseRetentionDays } from "../domain/gc-utils";

const fetchExpiredArtifactBatch = async (env: Env, profile: string, cutoff: string) => {
  const { results } = await env.DB.prepare(
    `SELECT b."id", a."r2_key" AS "r2_key" FROM "builds" b JOIN "build_artifacts" a ON a."build_id" = b."id" WHERE b."profile" = ? AND b."created_at" < ? LIMIT ?`,
  )
    .bind(profile, cutoff, GC_BATCH_SIZE)
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
): Promise<number> =>
  Effect.runPromise(
    Effect.iterate(
      { hasMore: true, totalDeleted },
      {
        while: (state) => state.hasMore,
        body: (state) =>
          Effect.gen(function* () {
            const batch = yield* Effect.promise(async () =>
              fetchExpiredArtifactBatch(env, profile, cutoff),
            );
            if (batch.length === 0) {
              return { hasMore: false, totalDeleted: state.totalDeleted };
            }
            yield* Effect.promise(async () => deleteArtifactBatch(env, batch));
            return { hasMore: true, totalDeleted: state.totalDeleted + batch.length };
          }),
      },
    ).pipe(Effect.map((state) => state.totalDeleted)),
  );

const cleanupOrphanedStaging = async (
  env: Env,
  cursor?: string,
  accumulated = 0,
): Promise<number> =>
  Effect.runPromise(
    Effect.iterate(
      { accumulated, cursor, hasMore: true },
      {
        while: (state) => state.hasMore,
        body: (state) =>
          Effect.gen(function* () {
            const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const listed = yield* Effect.promise(async () =>
              env.BUILD_BUCKET.list(
                state.cursor
                  ? { prefix: "staging/", cursor: state.cursor }
                  : { prefix: "staging/" },
              ),
            );
            const orphans = listed.objects.filter((obj) => obj.uploaded < threeHoursAgo);

            if (orphans.length > 0) {
              yield* Effect.promise(async () =>
                env.BUILD_BUCKET.delete(orphans.map((obj) => obj.key)),
              );
            }

            return listed.truncated
              ? {
                  accumulated: state.accumulated + orphans.length,
                  cursor: listed.cursor,
                  hasMore: true,
                }
              : {
                  accumulated: state.accumulated + orphans.length,
                  cursor: undefined,
                  hasMore: false,
                };
          }),
      },
    ).pipe(Effect.map((state) => state.accumulated)),
  );

const processProfiles = async (
  env: Env,
  profiles: readonly { name: string; days: number }[],
  accumulated: number,
): Promise<number> =>
  Effect.runPromise(
    Effect.forEach(
      profiles,
      (profile) =>
        Effect.promise(async () =>
          processProfileRetention(env, profile.name, computeCutoff(profile.days), 0),
        ),
      { concurrency: 1 },
    ).pipe(
      Effect.map(
        (deletedCounts) => accumulated + deletedCounts.reduce((sum, count) => sum + count, 0),
      ),
    ),
  );

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
