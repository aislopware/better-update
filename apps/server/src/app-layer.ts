import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import type { unhandled } from "effect/Types";
import type { HttpServerResponse } from "effect/unstable/http";

import { ManagementApi } from "./api";
import { AuthenticationLive } from "./auth/middleware";
import {
  AccountKeysGroupLive,
  AdminGroupLive,
  AnalyticsGroupLive,
  AndroidApplicationIdentifiersGroupLive,
  AndroidBuildCredentialsGroupLive,
  AndroidUploadKeystoresGroupLive,
  AppleDistributionCertificatesGroupLive,
  ApplePassTypeCertificatesGroupLive,
  ApplePayCertificatesGroupLive,
  AppleProvisioningProfilesGroupLive,
  ApplePushCertificatesGroupLive,
  ApplePushKeysGroupLive,
  AppleTeamsGroupLive,
  AscApiKeysGroupLive,
  AssetsGroupLive,
  AuditLogsGroupLive,
  BranchesGroupLive,
  BuildCredentialsGroupLive,
  BuildsGroupLive,
  ChannelsGroupLive,
  DevicesGroupLive,
  EnvironmentsGroupLive,
  EnvVarsGroupLive,
  EnvVaultGroupLive,
  FingerprintsGroupLive,
  GoogleServiceAccountKeysGroupLive,
  InvitationsGroupLive,
  IosAppMetadataGroupLive,
  IosBundleConfigurationsGroupLive,
  MeGroupLive,
  MembersGroupLive,
  CredentialBindingsGroupLive,
  ProjectMembersGroupLive,
  OrganizationGroupLive,
  OrgVaultGroupLive,
  ProjectsGroupLive,
  RobotAccountsGroupLive,
  RuntimesGroupLive,
  SubmissionsGroupLive,
  UpdatesGroupLive,
  UserEncryptionKeysGroupLive,
  WebVaultGroupLive,
  WebhooksGroupLive,
} from "./handlers";
import { ServerInfrastructureLayer } from "./infrastructure-layer";
import { ErrorFormatMiddlewareLive } from "./middleware/error-format";
import { JsonLoggerLayer } from "./middleware/logging";

import type { ServerInfrastructure } from "./infrastructure-layer";

const ManagementGroupsLayer = Layer.mergeAll(
  AccountKeysGroupLive,
  AdminGroupLive,
  AnalyticsGroupLive,
  AndroidApplicationIdentifiersGroupLive,
  AndroidBuildCredentialsGroupLive,
  AndroidUploadKeystoresGroupLive,
  AppleDistributionCertificatesGroupLive,
  ApplePassTypeCertificatesGroupLive,
  ApplePayCertificatesGroupLive,
  AppleProvisioningProfilesGroupLive,
  ApplePushCertificatesGroupLive,
  ApplePushKeysGroupLive,
  AppleTeamsGroupLive,
  AscApiKeysGroupLive,
  AssetsGroupLive,
  AuditLogsGroupLive,
  BranchesGroupLive,
  BuildCredentialsGroupLive,
  BuildsGroupLive,
  ChannelsGroupLive,
  DevicesGroupLive,
  EnvironmentsGroupLive,
  EnvVarsGroupLive,
  EnvVaultGroupLive,
  FingerprintsGroupLive,
  GoogleServiceAccountKeysGroupLive,
  InvitationsGroupLive,
  IosAppMetadataGroupLive,
  IosBundleConfigurationsGroupLive,
  MeGroupLive,
  MembersGroupLive,
  CredentialBindingsGroupLive,
  ProjectMembersGroupLive,
  OrganizationGroupLive,
  OrgVaultGroupLive,
  ProjectsGroupLive,
  RobotAccountsGroupLive,
  RuntimesGroupLive,
  SubmissionsGroupLive,
  UpdatesGroupLive,
  UserEncryptionKeysGroupLive,
  WebVaultGroupLive,
  WebhooksGroupLive,
);

/**
 * v4 tracks endpoint-handler requirements as PER-REQUEST services
 * (`Request<"Requires", X>`), which a plain `Layer.provide` on the group layers
 * can no longer discharge — only a router middleware can reach into a request.
 * The infrastructure layer is built ONCE here (scoped to the handler) and its
 * context handed to every request, so repos and adapters are still constructed
 * exactly once per isolate; they read the per-request Cloudflare env off the
 * fiber context (`cloudflare/context.ts`), not off the layer.
 */
const InfrastructureMiddlewareLive = HttpRouter.middleware<{
  provides: ServerInfrastructure;
}>()(
  Effect.map(
    Layer.build(ServerInfrastructureLayer),
    (context) =>
      (
        httpEffect: Effect.Effect<
          HttpServerResponse.HttpServerResponse,
          unhandled,
          ServerInfrastructure
        >,
      ) =>
        Effect.provideContext(httpEffect, context),
  ),
  { global: true },
);

// v4 registers the API (and its OpenAPI document) straight onto the router, so
// there is no separate `middlewareOpenApi` layer; `openapiPath` keeps the spec
// on the same `/api/openapi.json` URL v3 served it from.
export const ApiLive = HttpApiBuilder.layer(ManagementApi, {
  openapiPath: "/api/openapi.json",
}).pipe(Layer.provide(ManagementGroupsLayer), Layer.provide(AuthenticationLive));

const ScalarDocsLive = HttpApiScalar.layerCdn(ManagementApi, { path: "/docs" });

export const DocsLive = ScalarDocsLive;

export const makeManagementWebHandler = () =>
  HttpRouter.toWebHandler(
    // `layerServices` (FileSystem/Path/HttpPlatform/Etag) is a DEPENDENCY of
    // ApiLive, so it has to be provided rather than merged in parallel.
    Layer.mergeAll(ApiLive, DocsLive, ErrorFormatMiddlewareLive, JsonLoggerLayer).pipe(
      // `Layer.provide`, not `mergeAll`: the infrastructure middleware has to
      // FEED the routes' per-request requirements, which a parallel merge would
      // leave undischarged.
      Layer.provide(InfrastructureMiddlewareLive),
      Layer.provideMerge(HttpServer.layerServices),
    ),
  );
