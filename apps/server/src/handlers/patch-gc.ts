import { Effect } from "effect";

import { AssetStorage } from "../cloudflare/asset-storage";
import { provideCloudflareEnv } from "../cloudflare/context";
import { GC_BATCH_SIZE, computeCutoff, parseRetentionDays } from "../domain/gc-utils";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { PatchRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";

const runPatchGcEffect = async <Success, Error>(
  effect: Effect.Effect<Success, Error, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const fetchExpiredBatch = (cutoff: string) =>
  Effect.gen(function* () {
    const repo = yield* PatchRepo;
    return yield* repo.findExpired({ cutoff, limit: GC_BATCH_SIZE });
  });

const deleteBatch = (
  batch: readonly {
    readonly old_asset_hash: string;
    readonly new_asset_hash: string;
    readonly r2_key: string;
  }[],
) =>
  Effect.gen(function* () {
    const storage = yield* AssetStorage;
    const repo = yield* PatchRepo;

    yield* storage.deleteObjects({ keys: batch.map((row) => row.r2_key) });
    yield* repo.deleteBatch({
      patches: batch.map((row) => ({
        oldHash: row.old_asset_hash,
        newHash: row.new_asset_hash,
      })),
    });
  });

const processExpiredBatches = async (env: Env, cutoff: string): Promise<number> =>
  Effect.runPromise(
    Effect.iterate(
      { hasMore: true, totalDeleted: 0 },
      {
        while: (state) => state.hasMore,
        body: (state) =>
          Effect.gen(function* () {
            const batch = yield* Effect.promise(async () =>
              runPatchGcEffect(fetchExpiredBatch(cutoff), env),
            );
            if (batch.length === 0) {
              return { hasMore: false, totalDeleted: state.totalDeleted };
            }

            yield* Effect.promise(async () => runPatchGcEffect(deleteBatch(batch), env));
            return { hasMore: true, totalDeleted: state.totalDeleted + batch.length };
          }),
      },
    ).pipe(Effect.map((state) => state.totalDeleted)),
  );

export { handlePatchMessage } from "./patch-queue";
export { serveManifest } from "./manifest";

export const handleScheduled = async (env: Env): Promise<void> => {
  const retentionDays = parseRetentionDays(env.PATCH_RETENTION_DAYS);
  const cutoff = computeCutoff(retentionDays);
  const totalDeleted = await processExpiredBatches(env, cutoff);

  if (totalDeleted > 0) {
    console.info("[patch-gc] Cleaned up expired patches", { totalDeleted });
  }

  const { handleBuildGc } = await import("./build-gc");
  await handleBuildGc(env);
};
