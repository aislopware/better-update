import { Effect } from "effect";
import { sum } from "es-toolkit";

import { BuildRuntime } from "../cloudflare/build-runtime";
import { provideCloudflareEnv } from "../cloudflare/context";
import { GC_BATCH_SIZE, computeCutoff, parseRetentionDays } from "../domain/gc-utils";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { structuredLog } from "../middleware/logging";
import { BuildRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

const provideGcLayer = <Success, Failure>(
  effect: Effect.Effect<Success, Failure, ServerInfrastructure>,
  env: Env,
) =>
  effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
    provideCloudflareEnv(program, env),
  );

// One retention batch per round, recursing while rows remain. v4 dropped
// `Effect.iterate`; self-recursion is the idiomatic replacement and stays
// stack-safe because `Effect.gen` is trampolined.
const processProfileRetention = (
  profile: string,
  cutoff: string,
  totalDeleted = 0,
): Effect.Effect<number, never, BuildRepo | BuildRuntime> =>
  Effect.gen(function* () {
    const repo = yield* BuildRepo;
    const batch = yield* repo.findExpiredArtifactBatch({
      profile,
      cutoff,
      limit: GC_BATCH_SIZE,
    });

    if (batch.length === 0) {
      return totalDeleted;
    }

    const runtime = yield* BuildRuntime;
    yield* runtime.deleteObjects({ keys: batch.map((row) => row.r2Key) });
    yield* repo.deleteArtifactMetadataBatch({ buildIds: batch.map((row) => row.id) });

    return yield* processProfileRetention(profile, cutoff, totalDeleted + batch.length);
  });

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
    return sum(profileResults);
  });

  const totalArtifactsDeleted = await Effect.runPromise(provideGcLayer(program, env));

  if (totalArtifactsDeleted > 0) {
    structuredLog("info", "Build GC cleanup complete", { totalArtifactsDeleted });
  }
};
