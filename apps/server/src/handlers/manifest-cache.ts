import { Effect } from "effect";

import { ManifestCacheStorage } from "../cloudflare/manifest-cache-storage";
import { isResponseType } from "../protocol/response-type";

import type { ResponseType } from "../protocol/response-type";

export type { ResponseType } from "../protocol/response-type";

interface CacheMeta {
  readonly updateId: string;
  readonly responseType: ResponseType;
}

interface CachedResponse {
  readonly response: Response;
  readonly updateId: string;
  readonly responseType: ResponseType;
}

const INTERNAL_TTL = 86_400;

export const buildCacheKey = (params: {
  readonly cacheVersion: number;
  readonly projectId: string;
  readonly channelName: string;
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly resolvedBranchId: string;
  readonly multipart: boolean;
  readonly expectSignature: boolean;
}) =>
  `https://cache.internal/_cache/v${params.cacheVersion}/manifest/${params.projectId}/${params.channelName}/${params.platform}/${params.runtimeVersion}/${params.resolvedBranchId}/${params.multipart ? "mp" : "json"}/${params.expectSignature ? "sig" : "nosig"}`;

const toCacheEntry = (response: Response, meta: CacheMeta) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${INTERNAL_TTL}`);
  headers.set("x-cache-update-id", meta.updateId);
  headers.set("x-cache-response-type", meta.responseType);
  return new Response(response.clone().body, { status: response.status, headers });
};

const fromCacheEntry = (cached: Response) => {
  const headers = new Headers(cached.headers);
  headers.delete("x-cache-update-id");
  headers.delete("x-cache-response-type");
  headers.set("cache-control", "private, max-age=0");
  return new Response(cached.body, { status: cached.status, headers });
};

export const matchCachedResponse = (
  cacheKey: string,
): Effect.Effect<CachedResponse | null, never, ManifestCacheStorage> =>
  Effect.gen(function* () {
    const storage = yield* ManifestCacheStorage;
    const cached = yield* storage.match(cacheKey);
    if (!cached) {
      return null;
    }

    const cachedUpdateId = cached.headers.get("x-cache-update-id");
    if (cachedUpdateId === null || cachedUpdateId.length === 0) {
      return null;
    }
    const cachedResponseType = cached.headers.get("x-cache-response-type");
    return {
      response: fromCacheEntry(cached),
      updateId: cachedUpdateId,
      responseType: isResponseType(cachedResponseType) ? cachedResponseType : "manifest",
    };
  });

export const storeCachedResponse = (cacheKey: string, response: Response, meta: CacheMeta) =>
  Effect.gen(function* () {
    const storage = yield* ManifestCacheStorage;
    yield* storage.put(cacheKey, toCacheEntry(response, meta));
  });
