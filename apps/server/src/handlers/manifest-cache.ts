import { Effect } from "effect";

import { cloudflareCtx } from "../cloudflare/context";

export type ResponseType = "manifest" | "directive" | "no_update";

interface CacheMeta {
  readonly updateId: string;
  readonly responseType: ResponseType;
}

interface CachedResponse {
  readonly response: Response;
  readonly updateId: string;
  readonly responseType: ResponseType;
}

const CACHE_NAME = "manifests";
const INTERNAL_TTL = 86_400;

const isResponseType = (value: string | null): value is ResponseType =>
  value === "manifest" || value === "directive" || value === "no_update";

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

export const matchCachedResponse = (cacheKey: string) =>
  Effect.promise(async (): Promise<CachedResponse | null> => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (!cached) {
      return null;
    }

    const cachedResponseType = cached.headers.get("x-cache-response-type");
    return {
      response: fromCacheEntry(cached),
      updateId: cached.headers.get("x-cache-update-id") ?? "",
      responseType: isResponseType(cachedResponseType) ? cachedResponseType : "manifest",
    };
  });

export const storeCachedResponse = (cacheKey: string, response: Response, meta: CacheMeta) =>
  Effect.gen(function* () {
    const ctx = yield* cloudflareCtx;
    const cache = yield* Effect.promise(async () => caches.open(CACHE_NAME));
    ctx.waitUntil(cache.put(cacheKey, toCacheEntry(response, meta)));
  });
