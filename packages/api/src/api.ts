import { HttpApi, OpenApi } from "@effect/platform";

import { Authentication } from "./auth/middleware";
import { AnalyticsGroup } from "./groups/analytics";
import { AndroidApplicationIdentifiersGroup } from "./groups/android-application-identifiers";
import { AndroidBuildCredentialsGroup } from "./groups/android-build-credentials";
import { AndroidUploadKeystoresGroup } from "./groups/android-upload-keystores";
import { AppleDistributionCertificatesGroup } from "./groups/apple-distribution-certificates";
import { AppleProvisioningProfilesGroup } from "./groups/apple-provisioning-profiles";
import { ApplePushKeysGroup } from "./groups/apple-push-keys";
import { AppleTeamsGroup } from "./groups/apple-teams";
import { AscApiKeysGroup } from "./groups/asc-api-keys";
import { AssetsGroup } from "./groups/assets";
import { AuditLogsGroup } from "./groups/audit-logs";
import { BranchesGroup } from "./groups/branches";
import { BuildCredentialsGroup } from "./groups/build-credentials";
import { BuildsGroup } from "./groups/builds";
import { ChannelsGroup } from "./groups/channels";
import { DevicesGroup } from "./groups/devices";
import { EnvVarsGroup } from "./groups/env-vars";
import { FingerprintsGroup } from "./groups/fingerprints";
import { GoogleServiceAccountKeysGroup } from "./groups/google-service-account-keys";
import { IosAppMetadataGroup } from "./groups/ios-app-metadata";
import { IosBundleConfigurationsGroup } from "./groups/ios-bundle-configurations";
import { MeGroup } from "./groups/me";
import { OrgVaultGroup } from "./groups/org-vault";
import { ProjectsGroup } from "./groups/projects";
import { SubmissionsGroup } from "./groups/submissions";
import { UpdatesGroup } from "./groups/updates";
import { UserEncryptionKeysGroup } from "./groups/user-encryption-keys";
import { WebhooksGroup } from "./groups/webhooks";

export class ManagementApi extends HttpApi.make("management-api")
  .add(ProjectsGroup)
  .add(BranchesGroup)
  .add(ChannelsGroup)
  .add(UpdatesGroup)
  .add(AssetsGroup)
  .add(AnalyticsGroup)
  .add(BuildsGroup)
  .add(EnvVarsGroup)
  .add(FingerprintsGroup)
  .add(AuditLogsGroup)
  .add(DevicesGroup)
  .add(AppleTeamsGroup)
  .add(AppleDistributionCertificatesGroup)
  .add(ApplePushKeysGroup)
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
  .add(MeGroup)
  .add(WebhooksGroup)
  .middleware(Authentication)
  .annotateContext(
    OpenApi.annotations({
      title: "Better Update Management API",
      version: "1.0.0",
      description: "Management API for OTA update publishing, deployment, and analytics",
    }),
  ) {}
