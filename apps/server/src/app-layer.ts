import { HttpApiBuilder, HttpApiScalar, HttpServer } from "@effect/platform";
import { Layer } from "effect";

import { ManagementApi } from "./api";
import { AuthenticationLive } from "./auth/middleware";
import {
  AnalyticsGroupLive,
  AssetsGroupLive,
  AuditLogsGroupLive,
  BranchesGroupLive,
  BuildsGroupLive,
  ChannelsGroupLive,
  CredentialsGroupLive,
  EnvVarsGroupLive,
  ProjectsGroupLive,
  UpdatesGroupLive,
} from "./handlers";
import { AdapterLayer, RepositoryLayer } from "./infrastructure-layer";
import { errorFormatMiddleware } from "./middleware/error-format";

const ManagementGroupsLayer = Layer.mergeAll(
  AnalyticsGroupLive,
  AssetsGroupLive,
  AuditLogsGroupLive,
  BranchesGroupLive,
  BuildsGroupLive,
  ChannelsGroupLive,
  CredentialsGroupLive,
  EnvVarsGroupLive,
  ProjectsGroupLive,
  UpdatesGroupLive,
).pipe(Layer.provide(RepositoryLayer), Layer.provide(AdapterLayer));

export const ApiLive = HttpApiBuilder.api(ManagementApi).pipe(
  Layer.provide(ManagementGroupsLayer),
  Layer.provide(AuthenticationLive),
);

const OpenApiLive = Layer.provide(HttpApiBuilder.middlewareOpenApi(), ApiLive);

const ScalarDocsLive = Layer.provide(HttpApiScalar.layerCdn({ path: "/docs" }), ApiLive);

export const DocsLive = Layer.mergeAll(OpenApiLive, ScalarDocsLive);

export const makeManagementWebHandler = () =>
  HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, DocsLive, HttpServer.layerContext), {
    middleware: errorFormatMiddleware,
  });
