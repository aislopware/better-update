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
import { BranchRepoLive, ProjectRepoLive } from "./repositories";

const ProjectsGroupWithRepo = ProjectsGroupLive.pipe(Layer.provide(ProjectRepoLive));
const BranchesGroupWithRepo = BranchesGroupLive.pipe(
  Layer.provide(BranchRepoLive),
  Layer.provide(ProjectRepoLive),
);

const ApiLive = HttpApiBuilder.api(ManagementApi).pipe(
  Layer.provide(ProjectsGroupWithRepo),
  Layer.provide(BranchesGroupWithRepo),
  Layer.provide(ChannelsGroupLive),
  Layer.provide(UpdatesGroupLive),
  Layer.provide(AssetsGroupLive),
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

export default {
  async fetch(request, env, ctx) {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error boundary
    try {
      setRequestContext(env, ctx);

      const url = new URL(request.url);

      // Better Auth handles its own auth routes
      if (url.pathname.startsWith("/api/auth")) {
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
      }

      // Expo Updates protocol — unauthenticated manifest serving
      const manifestMatch = /^\/manifest\/([^/]+)\/?$/.exec(url.pathname);
      if (manifestMatch?.[1]) {
        return await serveManifest(request, manifestMatch[1]);
      }

      // Effect HttpApi handles management routes + OpenAPI + Scalar docs
      return await handler(request);
    } catch {
      return internalError();
    }
  },
} satisfies ExportedHandler<Env>;
