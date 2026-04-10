import { HttpApiBuilder, HttpApiScalar, HttpServer } from "@effect/platform";
import { Layer } from "effect";

import { ManagementApi } from "./api";
import { createAuth } from "./auth";
import { AuthenticationLive } from "./auth/middleware";
import { setRequestContext } from "./cloudflare/context";
import { AnalyticsGroupLive } from "./handlers/analytics";
import { AssetsGroupLive } from "./handlers/assets";
import { BranchesGroupLive } from "./handlers/branches";
import { ChannelsGroupLive } from "./handlers/channels";
import { serveManifest } from "./handlers/manifest";
import { ProjectsGroupLive } from "./handlers/projects";
import { UpdatesGroupLive } from "./handlers/updates";
import { errorFormatMiddleware } from "./middleware/error-format";
import {
  AssetRepoLive,
  BranchRepoLive,
  ChannelRepoLive,
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
  Layer.provide(BranchRepoLive),
  Layer.provide(ChannelRepoLive),
  Layer.provide(ProjectRepoLive),
);

const AssetsGroupWithRepo = AssetsGroupLive.pipe(Layer.provide(AssetRepoLive));

const ApiLive = HttpApiBuilder.api(ManagementApi).pipe(
  Layer.provide(ProjectsGroupWithRepo),
  Layer.provide(BranchesGroupWithRepo),
  Layer.provide(ChannelsGroupWithRepo),
  Layer.provide(UpdatesGroupWithRepo),
  Layer.provide(AssetsGroupWithRepo),
  Layer.provide(AnalyticsGroupLive),
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

      // Binary asset upload — PUT /api/assets/:hash
      const assetUploadMatch = /^\/api\/assets\/([a-f0-9]+)$/.exec(url.pathname);
      if (assetUploadMatch?.[1] && request.method === "PUT") {
        return await handleAssetUpload(request, env, assetUploadMatch[1]);
      }

      // Effect HttpApi handles management routes + OpenAPI + Scalar docs
      return await handler(request);
    } catch {
      return internalError();
    }
  },
} satisfies ExportedHandler<Env>;
