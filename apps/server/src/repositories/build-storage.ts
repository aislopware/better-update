import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { r2Operation } from "../lib/r2-helpers";

// -- Port ------------------------------------------------------------------

// GC-facing R2 operations on the PRIVATE builds bucket (build artifacts,
// debug symbols, update sourcemaps). Exists so the application/ layer (OTA
// reaper) can clean up builds-bucket objects without importing cloudflare/
// (which the hexagonal boundary forbids) — the handler shell keeps using the
// richer BuildRuntime port directly.

export interface BuildStorageRepository {
  /** Delete BUILD_BUCKET objects by key (no-op on empty input). */
  readonly deleteObjects: (params: { readonly keys: readonly string[] }) => Effect.Effect<void>;
}

export class BuildStorageRepo extends Context.Tag("api/BuildStorageRepo")<
  BuildStorageRepo,
  BuildStorageRepository
>() {}

// -- R2 Adapter ------------------------------------------------------------

export const BuildStorageRepoLive = Layer.succeed(BuildStorageRepo, {
  deleteObjects: (params) =>
    Effect.gen(function* () {
      if (params.keys.length === 0) {
        return;
      }
      const env = yield* cloudflareEnv;
      yield* r2Operation(async () => env.BUILD_BUCKET.delete([...params.keys]));
    }),
});
