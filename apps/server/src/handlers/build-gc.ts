import { Effect } from "effect";

import { BuildRuntime } from "../cloudflare/build-runtime";
import { provideCloudflareEnv } from "../cloudflare/context";
import { GC_BATCH_SIZE, computeCutoff, parseRetentionDays } from "../domain/gc-utils";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { BuildRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

const provideGcLayer = <Success, Failure>(
  effect: Effect.Effect<Success, Failure, ServerInfrastructure>,
  env: Env,
) =>
  effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
    provideCloudflareEnv(program, env),
  );

const processProfileRetention = (profile: string, cutoff: string) =>
  Effect.iterate(
    { hasMore: true, totalDeleted: 0 },
    {
      while: (state) => state.hasMore,
      body: (state) =>
        Effect.gen(function* () {
          const repo = yield* BuildRepo;
          const batch = yield* repo.findExpiredArtifactBatch({
            profile,
            cutoff,
            limit: GC_BATCH_SIZE,
          });

          if (batch.length === 0) {
            return { hasMore: false, totalDeleted: state.totalDeleted };
          }

          const runtime = yield* BuildRuntime;
          yield* runtime.deleteObjects({ keys: batch.map((row) => row.r2Key) });
          yield* repo.deleteArtifactMetadataBatch({ buildIds: batch.map((row) => row.id) });

          return { hasMore: true, totalDeleted: state.totalDeleted + batch.length };
        }),
    },
  ).pipe(Effect.map((state) => state.totalDeleted));

const cleanupOrphanedStaging = Effect.iterate(
  { accumulated: 0, cursor: undefined as string | undefined, hasMore: true },
  {
    while: (state) => state.hasMore,
    body: (state) =>
      Effect.gen(function* () {
        const runtime = yield* BuildRuntime;
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
        const listed = yield* runtime.listObjects({
          prefix: "staging/",
          ...(state.cursor ? { cursor: state.cursor } : {}),
        });
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
).pipe(Effect.map((state) => state.accumulated));

export const handleBuildGc = async (env: Env): Promise<void> => {
  const profiles = [
    { name: "production", days: parseRetentionDays(env.BUILD_RETENTION_PRODUCTION) },
    { name: "preview", days: parseRetentionDays(env.BUILD_RETENTION_PREVIEW) },
    { name: "development", days: parseRetentionDays(env.BUILD_RETENTION_DEVELOPMENT) },
  ];

  const program = Effect.gen(function* () {
    const profileResults = yield* Effect.forEach(
      profiles,
      (profile) => processProfileRetention(profile.name, computeCutoff(profile.days)),
      { concurrency: 1 },
    );
    const totalArtifactsDeleted = profileResults.reduce((sum, count) => sum + count, 0);
    const orphansDeleted = yield* cleanupOrphanedStaging;
    return { totalArtifactsDeleted, orphansDeleted };
  });

  const { totalArtifactsDeleted, orphansDeleted } = await Effect.runPromise(
    provideGcLayer(program, env),
  );

  if (totalArtifactsDeleted > 0 || orphansDeleted > 0) {
    // eslint-disable-next-line no-console -- structured log for Workers Logpush
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        logLevel: "INFO",
        message: "Build GC cleanup complete",
        totalArtifactsDeleted,
        orphansDeleted,
      }),
    );
  }
};
