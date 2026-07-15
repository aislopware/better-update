import { Context, Effect, Layer } from "effect";

import { cloudflareCtx } from "./context";

/**
 * Port for purging Workers Cache — the HTTP cache Cloudflare places in FRONT of
 * the Worker (`cache.enabled` in wrangler.jsonc). This is a different layer
 * than the internal Cache API used by ManifestCacheStorage: Workers Cache
 * stores whole responses keyed by URL before the Worker even runs, so key-side
 * versioning (cache_version) cannot invalidate it — only an explicit tag purge
 * can evict a stored copy early.
 */
export interface WorkersCacheService {
  readonly purgeTags: (tags: readonly string[]) => Effect.Effect<void>;
}

export class WorkersCache extends Context.Tag("server/WorkersCache")<
  WorkersCache,
  WorkersCacheService
>() {}

export const WorkersCacheLive = Layer.succeed(WorkersCache, {
  purgeTags: (tags) =>
    Effect.gen(function* () {
      if (tags.length === 0) {
        return;
      }
      const ctx = yield* cloudflareCtx;
      // `ctx.cache` is absent when Workers Cache is not enabled for this worker
      // (local dev, vitest-pool-workers, preview) — purging is then a no-op.
      const { cache } = ctx;
      if (!cache) {
        return;
      }
      // Best-effort by design: purge shares the zone purge-API rate limiter, so
      // a rejected purge must never fail the request that triggered it — the
      // stale entry then simply ages out via its TTL.
      // eslint-disable-next-line promise/prefer-await-to-then -- waitUntil requires a detached promise; awaiting would block the response, and the catch is what makes the purge best-effort
      ctx.waitUntil(cache.purge({ tags: [...tags] }).catch(() => undefined));
    }),
});
