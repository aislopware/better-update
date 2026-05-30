import { Effect } from "effect";

import { reapPatches, reapUpdates } from "../application/ota-reaper";
import { provideCloudflareEnv } from "../cloudflare/context";
import { computeCutoff, parseRetentionDays } from "../domain/gc-utils";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import { structuredLog } from "../middleware/logging";

import type { ServerInfrastructure } from "../infrastructure-layer";

const provideGcLayer = <Success, Failure>(
  effect: Effect.Effect<Success, Failure, ServerInfrastructure>,
  env: Env,
) =>
  effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
    provideCloudflareEnv(program, env),
  );

// Scheduled OTA retention GC. Analogous to build-gc.ts but for update rows,
// their R2 assets, and orphaned/stale bsdiff patch blobs.
//
// IMPORTANT: reap updates BEFORE patches so the patch sweep's surviving-update
// set reflects this run's deletions — otherwise a patch whose `to` is reaped
// this run would still see `to` as surviving and be wrongly kept.
export const handleOtaGc = async (env: Env): Promise<void> => {
  const cutoff = computeCutoff(parseRetentionDays(env.UPDATE_RETENTION_DAYS));
  const patchCutoff = computeCutoff(parseRetentionDays(env.PATCH_RETENTION_DAYS));

  const program = Effect.gen(function* () {
    const updates = yield* reapUpdates({ cutoff });
    const patches = yield* reapPatches({ patchCutoff });
    return {
      updatesDeleted: updates.updatesDeleted,
      assetsDeleted: updates.assetsDeleted,
      patchesDeleted: patches.patchesDeleted,
      // P4 observability: the project fan-out is unpaginated + sequential. Emit
      // how many projects each phase iterated so a future per-run-budget timeout
      // truncating the fan-out (later projects un-reaped this run) is visible in
      // logs rather than silent. The run is idempotent, so a truncated run
      // self-heals on the next cron — but only if this metric flags it first.
      projectsProcessed: updates.projectsProcessed,
    };
  });

  const result = await Effect.runPromise(provideGcLayer(program, env));

  if (result.updatesDeleted > 0 || result.assetsDeleted > 0 || result.patchesDeleted > 0) {
    structuredLog("info", "OTA GC cleanup complete", result);
  }
};
