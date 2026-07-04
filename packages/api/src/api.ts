import { HttpApi, OpenApi } from "@effect/platform";

import { Authentication } from "./auth/middleware";
import { AccountKeysGroup } from "./groups/account-keys";
import { AdminGroup } from "./groups/admin";
import { AnalyticsGroup } from "./groups/analytics";
import { AndroidApplicationIdentifiersGroup } from "./groups/android-application-identifiers";
import { AndroidBuildCredentialsGroup } from "./groups/android-build-credentials";
import { AndroidUploadKeystoresGroup } from "./groups/android-upload-keystores";
import { AppleDistributionCertificatesGroup } from "./groups/apple-distribution-certificates";
import { ApplePassTypeCertificatesGroup } from "./groups/apple-pass-type-certificates";
import { ApplePayCertificatesGroup } from "./groups/apple-pay-certificates";
import { AppleProvisioningProfilesGroup } from "./groups/apple-provisioning-profiles";
import { ApplePushCertificatesGroup } from "./groups/apple-push-certificates";
import { ApplePushKeysGroup } from "./groups/apple-push-keys";
import { AppleTeamsGroup } from "./groups/apple-teams";
import { AscApiKeysGroup } from "./groups/asc-api-keys";
import { AssetsGroup } from "./groups/assets";
import { AuditLogsGroup } from "./groups/audit-logs";
import { BranchesGroup } from "./groups/branches";
import { BuildCredentialsGroup } from "./groups/build-credentials";
import { BuildsGroup } from "./groups/builds";
import { ChannelsGroup } from "./groups/channels";
import { CredentialBindingsGroup } from "./groups/credential-bindings";
import { DevicesGroup } from "./groups/devices";
import { EnvVarsGroup } from "./groups/env-vars";
import { EnvVaultGroup } from "./groups/env-vault";
import { EnvironmentsGroup } from "./groups/environments";
import { FingerprintsGroup } from "./groups/fingerprints";
import { GoogleServiceAccountKeysGroup } from "./groups/google-service-account-keys";
import { InvitationsGroup } from "./groups/invitations";
import { IosAppMetadataGroup } from "./groups/ios-app-metadata";
import { IosBundleConfigurationsGroup } from "./groups/ios-bundle-configurations";
import { MeGroup } from "./groups/me";
import { MembersGroup } from "./groups/members";
import { OrgVaultGroup } from "./groups/org-vault";
import { OrganizationGroup } from "./groups/organization";
import { ProjectMembersGroup } from "./groups/project-members";
import { ProjectsGroup } from "./groups/projects";
import { RobotAccountsGroup } from "./groups/robot-accounts";
import { RuntimesGroup } from "./groups/runtimes";
import { SubmissionsGroup } from "./groups/submissions";
import { UpdatesGroup } from "./groups/updates";
import { UserEncryptionKeysGroup } from "./groups/user-encryption-keys";
import { WebVaultGroup } from "./groups/web-vault";
import { WebhooksGroup } from "./groups/webhooks";

export class ManagementApi extends HttpApi.make("management-api")
  .add(ProjectsGroup)
  .add(BranchesGroup)
  .add(ChannelsGroup)
  .add(EnvironmentsGroup)
  .add(UpdatesGroup)
  .add(AssetsGroup)
  .add(AnalyticsGroup)
  .add(BuildsGroup)
  .add(RuntimesGroup)
  .add(EnvVarsGroup)
  .add(FingerprintsGroup)
  .add(AuditLogsGroup)
  .add(DevicesGroup)
  .add(AppleTeamsGroup)
  .add(AppleDistributionCertificatesGroup)
  .add(ApplePushKeysGroup)
  .add(ApplePushCertificatesGroup)
  .add(ApplePayCertificatesGroup)
  .add(ApplePassTypeCertificatesGroup)
  .add(AscApiKeysGroup)
  .add(AppleProvisioningProfilesGroup)
  .add(GoogleServiceAccountKeysGroup)
  .add(IosBundleConfigurationsGroup)
  .add(IosAppMetadataGroup)
  .add(SubmissionsGroup)
  .add(AndroidApplicationIdentifiersGroup)
  .add(AndroidUploadKeystoresGroup)
  .add(AndroidBuildCredentialsGroup)
  .add(BuildCredentialsGroup)
  .add(UserEncryptionKeysGroup)
  .add(OrgVaultGroup)
  .add(AccountKeysGroup)
  .add(EnvVaultGroup)
  .add(WebVaultGroup)
  .add(MeGroup)
  .add(WebhooksGroup)
  .add(RobotAccountsGroup)
  .add(InvitationsGroup)
  .add(MembersGroup)
  .add(ProjectMembersGroup)
  .add(CredentialBindingsGroup)
  .add(OrganizationGroup)
  .add(AdminGroup)
  .middleware(Authentication)
  .annotateContext(
    OpenApi.annotations({
      title: "Better Update Management API",
      version: "1.0.0",
      description: "Management API for OTA update publishing, deployment, and analytics",
    }),
  ) {}
