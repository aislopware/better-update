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
import { ProjectsGroupLive } from "./handlers/projects";
import { UpdatesGroupLive } from "./handlers/updates";
import { ProjectRepoLive } from "./repositories/projects";

const ProjectsGroupWithRepo = ProjectsGroupLive.pipe(Layer.provide(ProjectRepoLive));

const ApiLive = HttpApiBuilder.api(ManagementApi).pipe(
  Layer.provide(ProjectsGroupWithRepo),
  Layer.provide(BranchesGroupLive),
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
);

export default {
  async fetch(request, env, ctx) {
    setRequestContext(env, ctx);

    const url = new URL(request.url);

    // Better Auth handles its own auth routes
    if (url.pathname.startsWith("/api/auth")) {
      return createAuth(env).handler(request);
    }

    // Effect HttpApi handles management routes + OpenAPI + Scalar docs
    return handler(request);
  },
} satisfies ExportedHandler<Env>;
