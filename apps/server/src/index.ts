import { Effect } from "effect";

import type { Context } from "effect";

import { makeManagementWebHandler } from "./app-layer";
import { createAuth } from "./auth";
import { AssetStorage } from "./cloudflare/asset-storage";
import { makeCloudflareRequestContext, provideCloudflareEnv } from "./cloudflare/context";
import { handleScheduled, matchBuildRoute, serveManifest } from "./handlers";
import { ServerInfrastructureLayer } from "./infrastructure-layer";
import { structuredLog, withRequestLogging } from "./middleware/request-logging";
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

const internalError = () =>
  Response.json(
    { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
    { status: 500 },
  );

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
    structuredLog("error", "Auth handler error", {
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
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

export default {
  async fetch(request, env, ctx) {
    return withRequestLogging(request, async () => {
      const url = new URL(request.url);
      const requestContext = makeCloudflareRequestContext(
        env,
        ctx,
        request,
      ) as Context.Context<never>;

      // Better Auth handles its own auth routes
      if (url.pathname.startsWith("/api/auth")) {
        return handleAuth(request, env);
      }

      // Expo Updates protocol — unauthenticated manifest serving
      const manifestMatch = /^\/manifest\/([^/]+)\/?$/.exec(url.pathname);
      if (manifestMatch?.[1]) {
        return serveManifest(request, env, ctx, manifestMatch[1]);
      }

      // Public asset download — GET /assets/:hash (no auth, edge-cached)
      const assetDownloadMatch = /^\/assets\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (assetDownloadMatch?.[1] && request.method === "GET") {
        return handleAssetDownload(request, env, ctx, assetDownloadMatch[1]);
      }

      // Build routes — artifact download + iOS install plist
      const buildResponse = await matchBuildRoute(request, env, url.pathname);
      if (buildResponse) {
        return buildResponse;
      }

      // Effect HttpApi handles management routes + OpenAPI + Scalar docs
      return handler(request, requestContext);
    });
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env>;
