import {
  AndroidApplicationIdentifier,
  AndroidBuildCredentials,
  AndroidUploadKeystore,
  AppleDistributionCertificate,
  AppleProvisioningProfile,
  ApplePushKey,
  AppleTeam,
  AscApiKey,
  AssetUploadBody,
  Branch,
  BulkImportEnvVarsBody,
  CreateAndroidApplicationIdentifierBody,
  CreateAndroidBuildCredentialsBody,
  CreateBranchBody,
  CreateBranchRolloutBody,
  CreateChannelBody,
  CreateEnvVarBody,
  CreateIosBundleConfigurationBody,
  CreateProjectBody,
  CreateRegistrationRequestBody,
  CreateUpdateBody,
  Device,
  DeviceClass,
  DeviceRegistrationRequest,
  GenerateAppleProvisioningProfileBody,
  GoogleServiceAccountKey,
  IosBundleConfiguration,
  PeriodLiteral,
  Platform,
  Project,
  RegisterDeviceBody,
  RepublishBody,
  SyncDevicesResult,
  UpdateAndroidBuildCredentialsBody,
  UpdateBranchBody,
  UpdateChannelBody,
  UpdateDeviceBody,
  UpdateEnvVarBody,
  UpdateIosBundleConfigurationBody,
  UpdateProjectBody,
  UploadAndroidUploadKeystoreBody,
  UploadAppleDistributionCertificateBody,
  UploadAppleProvisioningProfileBody,
  UploadApplePushKeyBody,
  UploadAscApiKeyBody,
  UploadGoogleServiceAccountKeyBody,
} from "@better-update/api";
import { queryOptions } from "@tanstack/react-query";

import { runApi } from "./index";

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

export type AnalyticsPeriod = typeof PeriodLiteral.Type;
export type PlatformValue = typeof Platform.Type;
export type ProjectItem = typeof Project.Type;
export type ProjectDetail = ProjectItem;
export type BranchItem = typeof Branch.Type;
export type DeviceItem = typeof Device.Type;
export type DeviceClassValue = typeof DeviceClass.Type;
export type DeviceRegistrationRequestItem = typeof DeviceRegistrationRequest.Type;
export type SyncDevicesResultValue = typeof SyncDevicesResult.Type;
export type AppleTeamItem = typeof AppleTeam.Type;
export type AppleDistributionCertificateItem = typeof AppleDistributionCertificate.Type;
export type ApplePushKeyItem = typeof ApplePushKey.Type;
export type AscApiKeyItem = typeof AscApiKey.Type;
export type AppleProvisioningProfileItem = typeof AppleProvisioningProfile.Type;
export type GoogleServiceAccountKeyItem = typeof GoogleServiceAccountKey.Type;
export type IosBundleConfigurationItem = typeof IosBundleConfiguration.Type;
export type AndroidApplicationIdentifierItem = typeof AndroidApplicationIdentifier.Type;
export type AndroidUploadKeystoreItem = typeof AndroidUploadKeystore.Type;
export type AndroidBuildCredentialsItem = typeof AndroidBuildCredentials.Type;

// ---------------------------------------------------------------------------
// Query options factories
// ---------------------------------------------------------------------------

export const projectsQueryKey = (orgId: string) => ["org", orgId, "projects"] as const;

export const projectQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId] as const;

export const projectBySlugQueryKey = (orgId: string, slug: string) =>
  ["org", orgId, "project", "by-slug", slug] as const;

export const branchesQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "branches"] as const;

export const channelsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "channels"] as const;

export const updatesQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "updates"] as const;

export const adoptionQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "adoption"] as const;

export const updateAnalyticsQueryKey = (orgId: string, projectId: string, updateId: string) =>
  ["org", orgId, "project", projectId, "analytics", "updates", updateId] as const;

export const channelAnalyticsQueryKey = (orgId: string, projectId: string, channel: string) =>
  ["org", orgId, "project", projectId, "analytics", "channels", channel] as const;

export const platformAnalyticsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "platforms"] as const;

export const projectsQueryOptions = (orgId: string, page?: number, limit?: number) =>
  queryOptions({
    queryKey: [
      ...projectsQueryKey(orgId),
      ...(page != null ? [page] : []),
      ...(limit != null ? [limit] : []),
    ],
    queryFn: ({ signal }) =>
      runApi((api) => api.projects.list({ urlParams: { page, limit } }), signal),
    staleTime: 30_000,
  });

export const projectQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: projectQueryKey(orgId, projectId),
    queryFn: ({ signal }) => runApi((api) => api.projects.get({ path: { id: projectId } }), signal),
    staleTime: 30_000,
  });

export const projectBySlugQueryOptions = (orgId: string, slug: string) =>
  queryOptions({
    queryKey: projectBySlugQueryKey(orgId, slug),
    queryFn: ({ signal }) => runApi((api) => api.projects.getBySlug({ path: { slug } }), signal),
    staleTime: 30_000,
  });

export const branchesQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: branchesQueryKey(orgId, projectId),
    queryFn: ({ signal }) =>
      runApi((api) => api.branches.list({ urlParams: { projectId, limit: 1000 } }), signal),
    staleTime: 30_000,
  });

export const channelsQueryOptions = (orgId: string, projectId: string, limit?: number) =>
  queryOptions({
    queryKey: [...channelsQueryKey(orgId, projectId), ...(limit != null ? [limit] : [])],
    queryFn: ({ signal }) =>
      runApi((api) => api.channels.list({ urlParams: { projectId, limit } }), signal),
    staleTime: 30_000,
  });

export const updatesQueryOptions = (
  orgId: string,
  projectId: string,
  branchId?: string,
  limit?: number,
) =>
  queryOptions({
    queryKey: [
      ...updatesQueryKey(orgId, projectId),
      ...(branchId ? [branchId] : []),
      ...(limit != null ? [limit] : []),
    ],
    queryFn: ({ signal }) =>
      runApi((api) => api.updates.list({ urlParams: { projectId, branchId, limit } }), signal),
    staleTime: 30_000,
  });

export const adoptionQueryOptions = (orgId: string, projectId: string, period?: AnalyticsPeriod) =>
  queryOptions({
    queryKey: [...adoptionQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi((api) => api.analytics.adoption({ urlParams: { projectId, period } }), signal),
    staleTime: 60_000,
  });

export const updateAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  updateId: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...updateAnalyticsQueryKey(orgId, projectId, updateId), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi(
        (api) => api.analytics.updates({ urlParams: { projectId, updateId, period } }),
        signal,
      ),
    staleTime: 60_000,
  });

export const channelAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  channel: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...channelAnalyticsQueryKey(orgId, projectId, channel), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi(
        (api) => api.analytics.channels({ urlParams: { projectId, channel, period } }),
        signal,
      ),
    staleTime: 60_000,
  });

export const platformAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...platformAnalyticsQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi((api) => api.analytics.platforms({ urlParams: { projectId, period } }), signal),
    staleTime: 60_000,
  });

// ---------------------------------------------------------------------------
// Mutation functions
// ---------------------------------------------------------------------------

// Projects
export const createProject = (body: typeof CreateProjectBody.Type) =>
  runApi((api) => api.projects.create({ payload: body }));

export const renameProject = (id: string, body: typeof UpdateProjectBody.Type) =>
  runApi((api) => api.projects.rename({ path: { id }, payload: body }));

export const deleteProject = (id: string) => runApi((api) => api.projects.delete({ path: { id } }));

// Branches
export const createBranch = (body: typeof CreateBranchBody.Type) =>
  runApi((api) => api.branches.create({ payload: body }));

export const renameBranch = (id: string, body: typeof UpdateBranchBody.Type) =>
  runApi((api) => api.branches.rename({ path: { id }, payload: body }));

export const deleteBranch = (id: string) => runApi((api) => api.branches.delete({ path: { id } }));

// Channels
export const createChannel = (body: typeof CreateChannelBody.Type) =>
  runApi((api) => api.channels.create({ payload: body }));

export const updateChannel = (id: string, body: typeof UpdateChannelBody.Type) =>
  runApi((api) => api.channels.update({ path: { id }, payload: body }));

export const pauseChannel = (id: string) => runApi((api) => api.channels.pause({ path: { id } }));

export const resumeChannel = (id: string) => runApi((api) => api.channels.resume({ path: { id } }));

export const deleteChannel = (id: string) => runApi((api) => api.channels.delete({ path: { id } }));

export const createBranchRollout = (channelId: string, body: typeof CreateBranchRolloutBody.Type) =>
  runApi((api) => api.channels.createBranchRollout({ path: { id: channelId }, payload: body }));

export const updateBranchRollout = (channelId: string, body: { percentage: number }) =>
  runApi((api) => api.channels.updateBranchRollout({ path: { id: channelId }, payload: body }));

export const completeBranchRollout = (channelId: string) =>
  runApi((api) => api.channels.completeBranchRollout({ path: { id: channelId } }));

export const revertBranchRollout = (channelId: string) =>
  runApi((api) => api.channels.revertBranchRollout({ path: { id: channelId } }));

// Updates
export const createUpdate = (body: typeof CreateUpdateBody.Type) =>
  runApi((api) => api.updates.create({ payload: body }));

export const deleteUpdateGroup = (groupId: string) =>
  runApi((api) => api.updates.deleteGroup({ path: { groupId } }));

export const republishUpdate = (body: typeof RepublishBody.Type) =>
  runApi((api) => api.updates.republish({ payload: body }));

export const editUpdateRollout = (id: string, body: { percentage: number }) =>
  runApi((api) => api.updates.editRollout({ path: { id }, payload: body }));

export const completeUpdateRollout = (id: string) =>
  runApi((api) => api.updates.completeRollout({ path: { id } }));

export const revertUpdateRollout = (id: string) =>
  runApi((api) => api.updates.revertRollout({ path: { id } }));

// Assets
export const uploadAssets = (body: typeof AssetUploadBody.Type) =>
  runApi((api) => api.assets.upload({ payload: body }));

export const finalizeAsset = (hash: string) =>
  runApi((api) => api.assets.finalize({ path: { hash } }));

// ---------------------------------------------------------------------------
// Builds — Query options
// ---------------------------------------------------------------------------

export const buildsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "builds"] as const;

export const buildQueryKey = (orgId: string, buildId: string) =>
  ["org", orgId, "build", buildId] as const;

export const buildCompatibilityMatrixQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "build-compatibility-matrix"] as const;

export const buildsQueryOptions = (
  orgId: string,
  projectId: string,
  filters?: { platform?: PlatformValue; profile?: string; runtimeVersion?: string },
  page?: number,
) =>
  queryOptions({
    queryKey: [
      ...buildsQueryKey(orgId, projectId),
      {
        platform: filters?.platform,
        profile: filters?.profile,
        runtimeVersion: filters?.runtimeVersion,
        page,
      },
    ],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api.builds.list({
            urlParams: {
              projectId,
              platform: filters?.platform,
              profile: filters?.profile,
              runtimeVersion: filters?.runtimeVersion,
              page,
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const buildQueryOptions = (orgId: string, buildId: string) =>
  queryOptions({
    queryKey: buildQueryKey(orgId, buildId),
    queryFn: ({ signal }) => runApi((api) => api.builds.get({ path: { id: buildId } }), signal),
    staleTime: 30_000,
  });

export const buildCompatibilityMatrixQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
    queryFn: ({ signal }) =>
      runApi((api) => api.builds.compatibilityMatrix({ urlParams: { projectId } }), signal),
    staleTime: 30_000,
  });

// Builds — Mutations
export const deleteBuild = (id: string) => runApi((api) => api.builds.delete({ path: { id } }));

export const fetchInstallLink = (buildId: string) =>
  runApi((api) => api.builds.getInstallLink({ path: { id: buildId } }));

// ---------------------------------------------------------------------------
// Apple Teams — Query options
// ---------------------------------------------------------------------------

export const appleTeamsQueryKey = (orgId: string) => ["org", orgId, "apple-teams"] as const;

export const appleTeamsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: appleTeamsQueryKey(orgId),
    queryFn: ({ signal }) => runApi((api) => api.appleTeams.list(), signal),
    staleTime: 30_000,
  });

// ---------------------------------------------------------------------------
// Apple Distribution Certificates — Query options + Mutations
// ---------------------------------------------------------------------------

export const appleDistributionCertificatesQueryKey = (orgId: string) =>
  ["org", orgId, "apple-distribution-certificates"] as const;

export const appleDistributionCertificatesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: appleDistributionCertificatesQueryKey(orgId),
    queryFn: ({ signal }) => runApi((api) => api.appleDistributionCertificates.list(), signal),
    staleTime: 30_000,
  });

export const uploadAppleDistributionCertificate = (
  body: typeof UploadAppleDistributionCertificateBody.Type,
) => runApi((api) => api.appleDistributionCertificates.upload({ payload: body }));

export const deleteAppleDistributionCertificate = (id: string) =>
  runApi((api) => api.appleDistributionCertificates.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Apple Push Keys — Query options + Mutations
// ---------------------------------------------------------------------------

export const applePushKeysQueryKey = (orgId: string) => ["org", orgId, "apple-push-keys"] as const;

export const applePushKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: applePushKeysQueryKey(orgId),
    queryFn: ({ signal }) => runApi((api) => api.applePushKeys.list(), signal),
    staleTime: 30_000,
  });

export const uploadApplePushKey = (body: typeof UploadApplePushKeyBody.Type) =>
  runApi((api) => api.applePushKeys.upload({ payload: body }));

export const deleteApplePushKey = (id: string) =>
  runApi((api) => api.applePushKeys.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// ASC API Keys — Query options + Mutations
// ---------------------------------------------------------------------------

export const ascApiKeysQueryKey = (orgId: string) => ["org", orgId, "asc-api-keys"] as const;

export const ascApiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ascApiKeysQueryKey(orgId),
    queryFn: ({ signal }) => runApi((api) => api.ascApiKeys.list(), signal),
    staleTime: 30_000,
  });

export const uploadAscApiKey = (body: typeof UploadAscApiKeyBody.Type) =>
  runApi((api) => api.ascApiKeys.upload({ payload: body }));

export const deleteAscApiKey = (id: string) =>
  runApi((api) => api.ascApiKeys.delete({ path: { id } }));

export const syncDevicesViaAscApiKey = (id: string) =>
  runApi((api) => api.ascApiKeys.syncDevices({ path: { id } }));

// ---------------------------------------------------------------------------
// Apple Provisioning Profiles — Query options + Mutations
// ---------------------------------------------------------------------------

export const appleProvisioningProfilesQueryKey = (
  orgId: string,
  filters?: {
    bundleIdentifier?: string;
    distributionType?: "APP_STORE" | "AD_HOC" | "ENTERPRISE" | "DEVELOPMENT";
    appleTeamId?: string;
  },
) => ["org", orgId, "apple-provisioning-profiles", filters ?? {}] as const;

export const appleProvisioningProfilesQueryOptions = (
  orgId: string,
  filters?: {
    bundleIdentifier?: string;
    distributionType?: "APP_STORE" | "AD_HOC" | "ENTERPRISE" | "DEVELOPMENT";
    appleTeamId?: string;
  },
) =>
  queryOptions({
    queryKey: appleProvisioningProfilesQueryKey(orgId, filters),
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api.appleProvisioningProfiles.list({
            urlParams: {
              ...(filters?.bundleIdentifier ? { bundleIdentifier: filters.bundleIdentifier } : {}),
              ...(filters?.distributionType ? { distributionType: filters.distributionType } : {}),
              ...(filters?.appleTeamId ? { appleTeamId: filters.appleTeamId } : {}),
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const uploadAppleProvisioningProfile = (
  body: typeof UploadAppleProvisioningProfileBody.Type,
) => runApi((api) => api.appleProvisioningProfiles.upload({ payload: body }));

export const generateAppleProvisioningProfile = (
  body: typeof GenerateAppleProvisioningProfileBody.Type,
) => runApi((api) => api.appleProvisioningProfiles.generate({ payload: body }));

export const deleteAppleProvisioningProfile = (id: string) =>
  runApi((api) => api.appleProvisioningProfiles.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Google Service Account Keys — Query options + Mutations
// ---------------------------------------------------------------------------

export const googleServiceAccountKeysQueryKey = (orgId: string) =>
  ["org", orgId, "google-service-account-keys"] as const;

export const googleServiceAccountKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: googleServiceAccountKeysQueryKey(orgId),
    queryFn: ({ signal }) => runApi((api) => api.googleServiceAccountKeys.list(), signal),
    staleTime: 30_000,
  });

export const uploadGoogleServiceAccountKey = (
  body: typeof UploadGoogleServiceAccountKeyBody.Type,
) => runApi((api) => api.googleServiceAccountKeys.upload({ payload: body }));

export const deleteGoogleServiceAccountKey = (id: string) =>
  runApi((api) => api.googleServiceAccountKeys.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// iOS Bundle Configurations — Query options + Mutations
// ---------------------------------------------------------------------------

export const iosBundleConfigurationsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "ios-bundle-configurations"] as const;

export const iosBundleConfigurationsQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: iosBundleConfigurationsQueryKey(orgId, projectId),
    queryFn: ({ signal }) =>
      runApi((api) => api.iosBundleConfigurations.list({ path: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createIosBundleConfiguration = (
  projectId: string,
  body: typeof CreateIosBundleConfigurationBody.Type,
) => runApi((api) => api.iosBundleConfigurations.create({ path: { projectId }, payload: body }));

export const updateIosBundleConfiguration = (
  id: string,
  body: typeof UpdateIosBundleConfigurationBody.Type,
) => runApi((api) => api.iosBundleConfigurations.update({ path: { id }, payload: body }));

export const deleteIosBundleConfiguration = (id: string) =>
  runApi((api) => api.iosBundleConfigurations.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Android Application Identifiers — Query options + Mutations
// ---------------------------------------------------------------------------

export const androidApplicationIdentifiersQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "android-application-identifiers"] as const;

export const androidApplicationIdentifiersQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: androidApplicationIdentifiersQueryKey(orgId, projectId),
    queryFn: ({ signal }) =>
      runApi((api) => api.androidApplicationIdentifiers.list({ path: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createAndroidApplicationIdentifier = (
  projectId: string,
  body: typeof CreateAndroidApplicationIdentifierBody.Type,
) =>
  runApi((api) => api.androidApplicationIdentifiers.create({ path: { projectId }, payload: body }));

export const deleteAndroidApplicationIdentifier = (id: string) =>
  runApi((api) => api.androidApplicationIdentifiers.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Android Upload Keystores — Query options + Mutations
// ---------------------------------------------------------------------------

export const androidUploadKeystoresQueryKey = (orgId: string) =>
  ["org", orgId, "android-upload-keystores"] as const;

export const androidUploadKeystoresQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: androidUploadKeystoresQueryKey(orgId),
    queryFn: ({ signal }) => runApi((api) => api.androidUploadKeystores.list(), signal),
    staleTime: 30_000,
  });

export const uploadAndroidUploadKeystore = (body: typeof UploadAndroidUploadKeystoreBody.Type) =>
  runApi((api) => api.androidUploadKeystores.upload({ payload: body }));

export const deleteAndroidUploadKeystore = (id: string) =>
  runApi((api) => api.androidUploadKeystores.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Android Build Credentials — Query options + Mutations
// ---------------------------------------------------------------------------

export const androidBuildCredentialsQueryKey = (orgId: string, applicationIdentifierId: string) =>
  [
    "org",
    orgId,
    "android-application-identifiers",
    applicationIdentifierId,
    "build-credentials",
  ] as const;

export const androidBuildCredentialsQueryOptions = (
  orgId: string,
  applicationIdentifierId: string,
) =>
  queryOptions({
    queryKey: androidBuildCredentialsQueryKey(orgId, applicationIdentifierId),
    queryFn: ({ signal }) =>
      runApi(
        (api) => api.androidBuildCredentials.list({ path: { applicationIdentifierId } }),
        signal,
      ),
    staleTime: 30_000,
  });

export const createAndroidBuildCredentials = (
  applicationIdentifierId: string,
  body: typeof CreateAndroidBuildCredentialsBody.Type,
) =>
  runApi((api) =>
    api.androidBuildCredentials.create({ path: { applicationIdentifierId }, payload: body }),
  );

export const updateAndroidBuildCredentials = (
  id: string,
  body: typeof UpdateAndroidBuildCredentialsBody.Type,
) => runApi((api) => api.androidBuildCredentials.update({ path: { id }, payload: body }));

export const deleteAndroidBuildCredentials = (id: string) =>
  runApi((api) => api.androidBuildCredentials.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Env Vars — Query options
// ---------------------------------------------------------------------------

export const envVarsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "env-vars"] as const;

export const envVarsQueryOptions = (orgId: string, projectId: string, environment?: string) =>
  queryOptions({
    queryKey: [...envVarsQueryKey(orgId, projectId), ...(environment ? [environment] : [])],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api["env-vars"].list({
            urlParams: { projectId, ...(environment ? { environment } : {}), limit: 100 },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

// Env Vars — Mutations
export const createEnvVar = (body: typeof CreateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].create({ payload: body }));

export const updateEnvVar = (id: string, body: typeof UpdateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].update({ path: { id }, payload: body }));

export const deleteEnvVar = (id: string) =>
  runApi((api) => api["env-vars"].delete({ path: { id } }));

export const bulkImportEnvVars = (body: typeof BulkImportEnvVarsBody.Type) =>
  runApi((api) => api["env-vars"].bulkImport({ payload: body }));

// ---------------------------------------------------------------------------
// Devices — Query options + Mutations
// ---------------------------------------------------------------------------

export const devicesQueryKey = (orgId: string) => ["org", orgId, "devices"] as const;

export const devicesQueryOptions = (
  orgId: string,
  filters?: {
    page?: number;
    limit?: number;
    search?: string;
    deviceClass?: DeviceClassValue;
    appleTeamId?: string;
  },
) =>
  queryOptions({
    queryKey: [
      ...devicesQueryKey(orgId),
      {
        page: filters?.page,
        limit: filters?.limit,
        search: filters?.search,
        deviceClass: filters?.deviceClass,
        appleTeamId: filters?.appleTeamId,
      },
    ],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api.devices.list({
            urlParams: {
              page: filters?.page,
              limit: filters?.limit,
              search: filters?.search,
              deviceClass: filters?.deviceClass,
              appleTeamId: filters?.appleTeamId,
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const registerDevice = (body: typeof RegisterDeviceBody.Type) =>
  runApi((api) => api.devices.register({ payload: body }));

export const updateDevice = (id: string, body: typeof UpdateDeviceBody.Type) =>
  runApi((api) => api.devices.update({ path: { id }, payload: body }));

export const deleteDevice = (id: string) => runApi((api) => api.devices.delete({ path: { id } }));

export const registrationRequestsQueryKey = (orgId: string) =>
  ["org", orgId, "device-registration-requests"] as const;

export const registrationRequestsQueryOptions = (orgId: string, activeOnly = true) =>
  queryOptions({
    queryKey: [...registrationRequestsQueryKey(orgId), { activeOnly }],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api.devices.listRegistrationRequests({
            urlParams: { active: activeOnly ? "true" : "false" },
          }),
        signal,
      ),
    staleTime: 15_000,
  });

export const createRegistrationRequest = (body: typeof CreateRegistrationRequestBody.Type) =>
  runApi((api) => api.devices.createRegistrationRequest({ payload: body }));

// ---------------------------------------------------------------------------
// Audit Logs — Query options
// ---------------------------------------------------------------------------

export const auditLogsQueryKey = (orgId: string, projectId?: string) =>
  projectId
    ? (["org", orgId, "project", projectId, "audit-logs"] as const)
    : (["org", orgId, "audit-logs"] as const);

export const auditLogsQueryOptions = (
  orgId: string,
  filters?: {
    projectId?: string;
    action?: string;
    resourceType?: string;
    actorId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  },
) =>
  queryOptions({
    queryKey: [...auditLogsQueryKey(orgId, filters?.projectId), filters],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api["audit-logs"].list({
            urlParams: { ...filters },
          }),
        signal,
      ),
    staleTime: 10_000,
  });
