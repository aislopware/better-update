import { Effect } from "effect";

import { BuildRuntime } from "../cloudflare/build-runtime";
import { provideCloudflareEnv } from "../cloudflare/context";
import { GC_BATCH_SIZE, computeCutoff, parseRetentionDays } from "../domain/gc-utils";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { BuildRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

const runBuildGcEffect = async <Success, Error>(
  effect: Effect.Effect<Success, Error, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const fetchExpiredArtifactBatch = (profile: string, cutoff: string) =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    return yield* repo.findExpiredArtifactBatch({ profile, cutoff, limit: GC_BATCH_SIZE });
  });

const deleteArtifactBatch = (batch: readonly { readonly id: string; readonly r2Key: string }[]) =>
  Effect.gen(function* () {
    const runtime = yield* BuildRuntime;
    const repo = yield* BuildRepo;

    yield* runtime.deleteObjects({ keys: batch.map((row) => row.r2Key) });
    yield* repo.deleteArtifactMetadataBatch({ buildIds: batch.map((row) => row.id) });
  });

const processProfileRetention = async (
  env: Env,
  profile: string,
  cutoff: string,
): Promise<number> =>
  Effect.runPromise(
    Effect.iterate(
      { hasMore: true, totalDeleted: 0 },
      {
        while: (state) => state.hasMore,
        body: (state) =>
          Effect.gen(function* () {
            const batch = yield* Effect.promise(async () =>
              runBuildGcEffect(fetchExpiredArtifactBatch(profile, cutoff), env),
            );
            if (batch.length === 0) {
              return { hasMore: false, totalDeleted: state.totalDeleted };
            }

            yield* Effect.promise(async () => runBuildGcEffect(deleteArtifactBatch(batch), env));
            return { hasMore: true, totalDeleted: state.totalDeleted + batch.length };
          }),
      },
    ).pipe(Effect.map((state) => state.totalDeleted)),
  );

const cleanupOrphanedStaging = async (env: Env): Promise<number> =>
  Effect.runPromise(
    Effect.iterate(
      { accumulated: 0, cursor: undefined as string | undefined, hasMore: true },
      {
        while: (state) => state.hasMore,
        body: (state) =>
          Effect.gen(function* () {
            const runtime = yield* BuildRuntime;
            const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const listed = yield* Effect.promise(async () =>
              runBuildGcEffect(
                runtime.listObjects({
                  prefix: "staging/",
                  ...(state.cursor ? { cursor: state.cursor } : {}),
                }),
                env,
              ),
            );
            const orphans = listed.objects.filter((object) => object.uploaded < threeHoursAgo);

            if (orphans.length > 0) {
              yield* runtime.deleteObjects({ keys: orphans.map((object) => object.key) });
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
    ).pipe(
      Effect.map((state) => state.accumulated),
      Effect.provide(ServerInfrastructureLayer),
      (program) => provideCloudflareEnv(program, env),
    ),
  );

const processProfiles = async (
  env: Env,
  profiles: readonly { name: string; days: number }[],
): Promise<number> =>
  Effect.runPromise(
    Effect.forEach(
      profiles,
      (profile) =>
        Effect.promise(async () =>
          processProfileRetention(env, profile.name, computeCutoff(profile.days)),
        ),
      { concurrency: 1 },
    ).pipe(Effect.map((deletedCounts) => deletedCounts.reduce((sum, count) => sum + count, 0))),
  );

export const handleBuildGc = async (env: Env): Promise<void> => {
  const profiles = [
    { name: "production", days: parseRetentionDays(env.BUILD_RETENTION_PRODUCTION) },
    { name: "preview", days: parseRetentionDays(env.BUILD_RETENTION_PREVIEW) },
    { name: "development", days: parseRetentionDays(env.BUILD_RETENTION_DEVELOPMENT) },
  ];

  const totalArtifactsDeleted = await processProfiles(env, profiles);
  const orphansDeleted = await cleanupOrphanedStaging(env);

  if (totalArtifactsDeleted > 0 || orphansDeleted > 0) {
    console.info("[build-gc] Cleanup complete", { totalArtifactsDeleted, orphansDeleted });
  }
};
