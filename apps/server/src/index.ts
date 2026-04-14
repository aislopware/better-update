import { Effect } from "effect";

import type { Context } from "effect";

import { makeManagementWebHandler } from "./app-layer";
import { createAuth } from "./auth";
import { AssetStorage } from "./cloudflare/asset-storage";
import { makeCloudflareRequestContext, provideCloudflareEnv } from "./cloudflare/context";
import { handleScheduled, matchBuildRoute, serveManifest } from "./handlers";
import { ServerInfrastructureLayer } from "./infrastructure-layer";
import { verifyAssetUploadToken } from "./lib/asset-upload-token";
import { toBase64Url } from "./lib/base64";
import { AssetRepo } from "./repositories";

import type { ServerInfrastructure } from "./infrastructure-layer";

export {
  CreateBranchCoordinator,
  PublishCoordinator,
} from "./durable-objects/publish-coordinators";
const { handler } = makeManagementWebHandler();

const runServerEnvEffect = async <Success, Failure>(
  effect: Effect.Effect<Success, Failure, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const findAssetByHash = (hash: string) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepo;
    return yield* repo.findByHash({ hash });
  });

const getAssetObject = (key: string) =>
  Effect.gen(function* () {
    const storage = yield* AssetStorage;
    return yield* storage.getObject({ key });
  });

const putAssetObject = (params: {
  readonly key: string;
  readonly body: ReadableStream | Uint8Array;
  readonly contentType: string;
}) =>
  Effect.gen(function* () {
    const storage = yield* AssetStorage;
    yield* storage.putObject(params);
  });

const updateAssetByteSize = (hash: string, byteSize: number) =>
  Effect.gen(function* () {
    const repo = yield* AssetRepo;
    yield* repo.updateByteSize({ hash, byteSize });
  });

const internalError = () =>
  Response.json(
    { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
    { status: 500 },
  );

const isAssetUploadAuthorized = async (
  headers: Headers,
  env: Env,
  hash: string,
): Promise<boolean> => {
  const token = headers.get("x-better-update-upload-token")?.trim();
  if (!token) {
    return false;
  }

  const payload = await verifyAssetUploadToken(token, env.BETTER_AUTH_SECRET).catch(() => null);
  return payload?.hash === hash;
};

/** Handle Better Auth routes with workarounds for dev-mode status codes and empty bodies */
const handleAuth = async (request: Request, env: Env): Promise<Response> => {
  // eslint-disable-next-line functional/no-try-statements -- Better Auth may throw unhandled exceptions
  try {
    const response = await createAuth(env).handler(request);

    // Workaround: @cloudflare/vite-plugin crashes on HTTP 401 from auxiliary
    // Workers (all other 4xx/5xx codes work). Remap 401 → 403 in development
    // So the client still receives a parseable JSON error body.
    if (response.status === 401) {
      const body = response.body ? await response.text() : null;
      return new Response(body, {
        status: 403,
        headers: response.headers,
      });
    }

    // Better-call returns null-body 500 for non-APIError exceptions (e.g. D1 errors);
    // Replace with a structured JSON body so the client always gets parseable output
    if (response.status >= 400 && !response.body) {
      return Response.json(
        { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
        { status: response.status },
      );
    }

    return response;
  } catch (error) {
    console.error("[auth]", error);
    return internalError();
  }
};

/** Public asset download — streams R2 object with edge caching */
const handleAssetDownload = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  hash: string,
): Promise<Response> => {
  // Check edge cache first (named cache for isolation from default CDN cache)
  const cache = await caches.open("assets");
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const asset = await runServerEnvEffect(findAssetByHash(hash), env);
  if (!asset) {
    return Response.json({ code: "NOT_FOUND", message: "Asset not found" }, { status: 404 });
  }

  const object = await runServerEnvEffect(getAssetObject(asset.r2Key), env);
  if (!object) {
    return Response.json({ code: "NOT_FOUND", message: "Asset not found" }, { status: 404 });
  }

  // Build response with immutable caching headers
  const headers = new Headers();
  if (object.contentType) {
    headers.set("content-type", object.contentType);
  }
  if (object.etag) {
    headers.set("etag", object.etag);
  }
  headers.set("content-length", object.size.toString());
  headers.set("cache-control", "public, max-age=31536000, immutable");

  const response = new Response(object.body, { headers });

  // Populate edge cache asynchronously
  ctx.waitUntil(cache.put(request, response.clone()));

  return response;
};

/** Binary asset upload — outside Effect HttpApi (streams body to R2) */
const handleAssetUpload = async (request: Request, env: Env, hash: string): Promise<Response> => {
  if (!(await isAssetUploadAuthorized(request.headers, env, hash))) {
    return Response.json(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 },
    );
  }

  const asset = await runServerEnvEffect(findAssetByHash(hash), env);
  if (!asset) {
    return Response.json({ code: "NOT_FOUND", message: "Asset not registered" }, { status: 404 });
  }

  if (asset.byteSize > 0) {
    return Response.json({ hash, r2Key: asset.r2Key }, { status: 200 });
  }

  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bodyBytes);
  const computedHash = toBase64Url(new Uint8Array(digest));

  if (computedHash !== hash) {
    return Response.json(
      {
        code: "BAD_REQUEST",
        message: `Asset hash mismatch: expected ${hash}, got ${computedHash}`,
      },
      { status: 400 },
    );
  }

  await runServerEnvEffect(
    putAssetObject({
      key: asset.r2Key,
      body: bodyBytes,
      contentType: asset.contentType,
    }),
    env,
  );

  await runServerEnvEffect(updateAssetByteSize(hash, bodyBytes.byteLength), env);

  return Response.json({ hash, r2Key: asset.r2Key }, { status: 200 });
};

export default {
  async fetch(request, env, ctx) {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error boundary
    try {
      const url = new URL(request.url);
      const requestContext = makeCloudflareRequestContext(
        env,
        ctx,
        request,
      ) as Context.Context<never>;

      // Better Auth handles its own auth routes
      if (url.pathname.startsWith("/api/auth")) {
        return await handleAuth(request, env);
      }

      // Expo Updates protocol — unauthenticated manifest serving
      const manifestMatch = /^\/manifest\/([^/]+)\/?$/.exec(url.pathname);
      if (manifestMatch?.[1]) {
        return await serveManifest(request, env, ctx, manifestMatch[1]);
      }

      // Public asset download — GET /assets/:hash (no auth, edge-cached)
      const assetDownloadMatch = /^\/assets\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (assetDownloadMatch?.[1] && request.method === "GET") {
        return await handleAssetDownload(request, env, ctx, assetDownloadMatch[1]);
      }

      // Binary asset upload — PUT /api/assets/:hash
      const assetUploadMatch = /^\/api\/assets\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (assetUploadMatch?.[1] && request.method === "PUT") {
        return await handleAssetUpload(request, env, assetUploadMatch[1]);
      }

      // Build routes — artifact download + iOS install plist
      const buildResponse = await matchBuildRoute(request, env, url.pathname);
      if (buildResponse) {
        return buildResponse;
      }

      // Effect HttpApi handles management routes + OpenAPI + Scalar docs
      return await handler(request, requestContext);
    } catch {
      return internalError();
    }
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
