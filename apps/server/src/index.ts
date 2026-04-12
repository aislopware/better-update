import { HttpApiBuilder, HttpApiScalar, HttpServer } from "@effect/platform";
import { Layer } from "effect";

import { ManagementApi } from "./api";
import { createAuth } from "./auth";
import { AuthenticationLive } from "./auth/middleware";
import { setRequestContext } from "./cloudflare/context";
import {
  AnalyticsGroupLive,
  AssetsGroupLive,
  BranchesGroupLive,
  BuildsGroupLive,
  ChannelsGroupLive,
  CredentialsGroupLive,
  ProjectsGroupLive,
  UpdatesGroupLive,
  handlePatchMessage,
  handleScheduled,
  matchBuildRoute,
  serveManifest,
} from "./handlers";
import { errorFormatMiddleware } from "./middleware/error-format";
import {
  AssetRepoLive,
  BranchRepoLive,
  BuildRepoLive,
  ChannelRepoLive,
  CredentialRepoLive,
  PatchRepoLive,
  ProjectRepoLive,
  UpdateRepoLive,
} from "./repositories";

const ProjectsGroupWithRepo = ProjectsGroupLive.pipe(Layer.provide(ProjectRepoLive));
const BranchesGroupWithRepo = BranchesGroupLive.pipe(
  Layer.provide(BranchRepoLive),
  Layer.provide(ProjectRepoLive),
);

const ChannelsGroupWithRepo = ChannelsGroupLive.pipe(
  Layer.provide(ChannelRepoLive),
  Layer.provide(BranchRepoLive),
  Layer.provide(ProjectRepoLive),
);

const UpdatesGroupWithRepo = UpdatesGroupLive.pipe(
  Layer.provide(UpdateRepoLive),
  Layer.provide(AssetRepoLive),
  Layer.provide(PatchRepoLive),
  Layer.provide(BranchRepoLive),
  Layer.provide(ChannelRepoLive),
  Layer.provide(ProjectRepoLive),
);

const BuildsGroupWithRepo = BuildsGroupLive.pipe(
  Layer.provide(BuildRepoLive),
  Layer.provide(ProjectRepoLive),
);

const CredentialsGroupWithRepo = CredentialsGroupLive.pipe(Layer.provide(CredentialRepoLive));

const AssetsGroupWithRepo = AssetsGroupLive.pipe(Layer.provide(AssetRepoLive));
const AnalyticsGroupWithRepo = AnalyticsGroupLive.pipe(Layer.provide(ProjectRepoLive));

const ApiLive = HttpApiBuilder.api(ManagementApi).pipe(
  Layer.provide(ProjectsGroupWithRepo),
  Layer.provide(BranchesGroupWithRepo),
  Layer.provide(ChannelsGroupWithRepo),
  Layer.provide(UpdatesGroupWithRepo),
  Layer.provide(BuildsGroupWithRepo),
  Layer.provide(CredentialsGroupWithRepo),
  Layer.provide(AssetsGroupWithRepo),
  Layer.provide(AnalyticsGroupWithRepo),
  Layer.provide(AuthenticationLive),
);

// OpenAPI + Scalar require Api (provided by ApiLive)
const DocsLive = Layer.merge(
  HttpApiBuilder.middlewareOpenApi(),
  HttpApiScalar.layerCdn({ path: "/docs" }),
).pipe(Layer.provide(ApiLive));

const { handler } = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(ApiLive, DocsLive, HttpServer.layerContext),
  { middleware: errorFormatMiddleware },
);

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

  // Look up asset in D1 to resolve r2Key
  const asset = await env.DB.prepare(
    `SELECT "r2_key", "content_type" FROM "assets" WHERE "hash" = ?`,
  )
    .bind(hash)
    .first<{ r2_key: string; content_type: string }>();
  if (!asset) {
    return Response.json({ code: "NOT_FOUND", message: "Asset not found" }, { status: 404 });
  }

  // Fetch from R2
  const object = await env.ASSETS_BUCKET.get(asset.r2_key);
  if (!object) {
    return Response.json({ code: "NOT_FOUND", message: "Asset not found" }, { status: 404 });
  }

  // Build response with immutable caching headers
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", object.size.toString());
  headers.set("cache-control", "public, max-age=31536000, immutable");

  const response = new Response(object.body, { headers });

  // Populate edge cache asynchronously
  ctx.waitUntil(cache.put(request, response.clone()));

  return response;
};

/** Binary asset upload — outside Effect HttpApi (streams body to R2) */
const handleAssetUpload = async (request: Request, env: Env, hash: string): Promise<Response> => {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return Response.json(
      { code: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 },
    );
  }

  // Look up asset in D1 to get r2Key and contentType
  const asset = await env.DB.prepare(
    `SELECT "r2_key", "content_type" FROM "assets" WHERE "hash" = ?`,
  )
    .bind(hash)
    .first<{ r2_key: string; content_type: string }>();
  if (!asset) {
    return Response.json({ code: "NOT_FOUND", message: "Asset not registered" }, { status: 404 });
  }

  // Stream body to R2
  await env.ASSETS_BUCKET.put(asset.r2_key, request.body, {
    httpMetadata: { contentType: asset.content_type },
  });

  // Update byte size
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    await env.DB.prepare(`UPDATE "assets" SET "byte_size" = ? WHERE "hash" = ?`)
      .bind(Number.parseInt(contentLength, 10), hash)
      .run();
  }

  return Response.json({ hash, r2Key: asset.r2_key }, { status: 200 });
};

/** Public patch download — streams R2 object with edge caching */
const handlePatchDownload = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  oldHash: string,
  newHash: string,
): Promise<Response> => {
  const cache = await caches.open("patches");
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const r2Key = `patches/${oldHash}/${newHash}.patch`;
  const object = await env.ASSETS_BUCKET.get(r2Key);
  if (!object) {
    return Response.json({ code: "NOT_FOUND", message: "Patch not found" }, { status: 404 });
  }

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  headers.set("content-length", object.size.toString());
  headers.set("cache-control", "public, max-age=31536000, immutable");

  const response = new Response(object.body, { headers });
  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
};

export default {
  async fetch(request, env, ctx) {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error boundary
    try {
      setRequestContext(env, ctx);

      const url = new URL(request.url);

      // Better Auth handles its own auth routes
      if (url.pathname.startsWith("/api/auth")) {
        return await handleAuth(request, env);
      }

      // Expo Updates protocol — unauthenticated manifest serving
      const manifestMatch = /^\/manifest\/([^/]+)\/?$/.exec(url.pathname);
      if (manifestMatch?.[1]) {
        return await serveManifest(request, manifestMatch[1]);
      }

      // Public asset download — GET /assets/:hash (no auth, edge-cached)
      const assetDownloadMatch = /^\/assets\/([a-f0-9]+)$/.exec(url.pathname);
      if (assetDownloadMatch?.[1] && request.method === "GET") {
        return await handleAssetDownload(request, env, ctx, assetDownloadMatch[1]);
      }

      // Binary asset upload — PUT /api/assets/:hash
      const assetUploadMatch = /^\/api\/assets\/([a-f0-9]+)$/.exec(url.pathname);
      if (assetUploadMatch?.[1] && request.method === "PUT") {
        return await handleAssetUpload(request, env, assetUploadMatch[1]);
      }

      // Build routes — artifact download + iOS install plist
      const buildResponse = await matchBuildRoute(request, env, url.pathname);
      if (buildResponse) {
        return buildResponse;
      }

      // Patch download — GET /patches/:oldHash/:newHash.patch (public, edge-cached)
      const patchDownloadMatch = /^\/patches\/([a-f\d]+)\/([a-f\d]+)\.patch$/.exec(url.pathname);
      if (patchDownloadMatch?.[1] && patchDownloadMatch[2] && request.method === "GET") {
        return await handlePatchDownload(
          request,
          env,
          ctx,
          patchDownloadMatch[1],
          patchDownloadMatch[2],
        );
      }

      // Effect HttpApi handles management routes + OpenAPI + Scalar docs
      return await handler(request);
    } catch {
      return internalError();
    }
  },

  async queue(batch, env) {
    await Promise.all(
      batch.messages.map(async (message) => {
        // eslint-disable-next-line functional/no-try-statements -- imperative shell error boundary for queue messages
        try {
          await handlePatchMessage(message.body, env);
          message.ack();
        } catch (error) {
          console.error("[patch-queue]", error);
          message.retry();
        }
      }),
    );
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<Env, { readonly oldHash: string; readonly newHash: string }>;
