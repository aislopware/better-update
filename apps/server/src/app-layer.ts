import { HttpApiBuilder, HttpApiScalar, HttpServer } from "@effect/platform";
import { Layer } from "effect";

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
  GroupsGroupLive,
  InvitationsGroupLive,
  IosAppMetadataGroupLive,
  IosBundleConfigurationsGroupLive,
  MeGroupLive,
  MembersGroupLive,
  OrganizationGroupLive,
  OrgVaultGroupLive,
  PoliciesGroupLive,
  PolicyAttachmentsGroupLive,
  ProjectsGroupLive,
  RobotAccountsGroupLive,
  RuntimesGroupLive,
  SubmissionsGroupLive,
  UpdatesGroupLive,
  UserEncryptionKeysGroupLive,
  WebVaultGroupLive,
  WebhooksGroupLive,
} from "./handlers";
import { AdapterLayer, RepositoryLayer } from "./infrastructure-layer";
import { errorFormatMiddleware } from "./middleware/error-format";
import { JsonLoggerLayer } from "./middleware/logging";

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
  GroupsGroupLive,
  InvitationsGroupLive,
  IosAppMetadataGroupLive,
  IosBundleConfigurationsGroupLive,
  MeGroupLive,
  MembersGroupLive,
  OrganizationGroupLive,
  OrgVaultGroupLive,
  PoliciesGroupLive,
  PolicyAttachmentsGroupLive,
  ProjectsGroupLive,
  RobotAccountsGroupLive,
  RuntimesGroupLive,
  SubmissionsGroupLive,
  UpdatesGroupLive,
  UserEncryptionKeysGroupLive,
  WebVaultGroupLive,
  WebhooksGroupLive,
).pipe(Layer.provide(RepositoryLayer), Layer.provide(AdapterLayer));

export const ApiLive = HttpApiBuilder.api(ManagementApi).pipe(
  Layer.provide(ManagementGroupsLayer),
  Layer.provide(AuthenticationLive),
);

const OpenApiLive = Layer.provide(HttpApiBuilder.middlewareOpenApi(), ApiLive);

const ScalarDocsLive = Layer.provide(HttpApiScalar.layerCdn({ path: "/docs" }), ApiLive);

export const DocsLive = Layer.mergeAll(OpenApiLive, ScalarDocsLive);

export const makeManagementWebHandler = () =>
  HttpApiBuilder.toWebHandler(
    Layer.mergeAll(ApiLive, DocsLive, HttpServer.layerContext, JsonLoggerLayer),
    {
      middleware: errorFormatMiddleware,
    },
  );
