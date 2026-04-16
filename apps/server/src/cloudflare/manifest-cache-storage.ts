import { Context, Effect, Layer } from "effect";

import { cloudflareCtx } from "./context";

const CACHE_NAME = "manifests";

export interface ManifestCacheStorageService {
  readonly match: (cacheKey: string) => Effect.Effect<Response | null>;
  readonly put: (cacheKey: string, response: Response) => Effect.Effect<void>;
}

export class ManifestCacheStorage extends Context.Tag("server/ManifestCacheStorage")<
  ManifestCacheStorage,
  ManifestCacheStorageService
>() {}

export const ManifestCacheStorageLive = Layer.succeed(ManifestCacheStorage, {
  match: (cacheKey) =>
    Effect.promise(async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(cacheKey);
      return cached ?? null;
    }),
  put: (cacheKey, response) =>
    Effect.gen(function* () {
      const ctx = yield* cloudflareCtx;
      const cache = yield* Effect.promise(async () => caches.open(CACHE_NAME));
      ctx.waitUntil(cache.put(cacheKey, response));
    }),
});
