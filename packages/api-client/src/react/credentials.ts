import { queryOptions } from "@tanstack/react-query";

import type {
  CreateAndroidApplicationIdentifierBody,
  CreateAndroidBuildCredentialsBody,
  CreateIosAppMetadataBody,
  CreateIosBundleConfigurationBody,
  UpdateAndroidBuildCredentialsBody,
  UpdateIosAppMetadataBody,
  UpdateIosBundleConfigurationBody,
  UploadAndroidUploadKeystoreBody,
  UploadAppleDistributionCertificateBody,
  UploadAppleProvisioningProfileBody,
  UploadApplePushKeyBody,
  UploadAscApiKeyBody,
  UploadGoogleServiceAccountKeyBody,
} from "@better-update/api";

import { runApi } from "../index";

export const appleTeamsQueryKey = (orgId: string) => ["org", orgId, "apple-teams"] as const;

export const appleTeamsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: appleTeamsQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.appleTeams.list(), signal),
    staleTime: 30_000,
  });

export const appleDistributionCertificatesQueryKey = (orgId: string) =>
  ["org", orgId, "apple-distribution-certificates"] as const;

export const appleDistributionCertificatesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: appleDistributionCertificatesQueryKey(orgId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.appleDistributionCertificates.list(), signal),
    staleTime: 30_000,
  });

export const uploadAppleDistributionCertificate = async (
  body: typeof UploadAppleDistributionCertificateBody.Type,
) => runApi((api) => api.appleDistributionCertificates.upload({ payload: body }));

export const deleteAppleDistributionCertificate = async (id: string) =>
  runApi((api) => api.appleDistributionCertificates.delete({ path: { id } }));

export const applePushKeysQueryKey = (orgId: string) => ["org", orgId, "apple-push-keys"] as const;

export const applePushKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: applePushKeysQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.applePushKeys.list(), signal),
    staleTime: 30_000,
  });

export const uploadApplePushKey = async (body: typeof UploadApplePushKeyBody.Type) =>
  runApi((api) => api.applePushKeys.upload({ payload: body }));

export const deleteApplePushKey = async (id: string) =>
  runApi((api) => api.applePushKeys.delete({ path: { id } }));

export const ascApiKeysQueryKey = (orgId: string) => ["org", orgId, "asc-api-keys"] as const;

export const ascApiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ascApiKeysQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.ascApiKeys.list(), signal),
    staleTime: 30_000,
  });

export const uploadAscApiKey = async (body: typeof UploadAscApiKeyBody.Type) =>
  runApi((api) => api.ascApiKeys.upload({ payload: body }));

export const deleteAscApiKey = async (id: string) =>
  runApi((api) => api.ascApiKeys.delete({ path: { id } }));

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
    queryFn: async ({ signal }) =>
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

export const uploadAppleProvisioningProfile = async (
  body: typeof UploadAppleProvisioningProfileBody.Type,
) => runApi((api) => api.appleProvisioningProfiles.upload({ payload: body }));

export const deleteAppleProvisioningProfile = async (id: string) =>
  runApi((api) => api.appleProvisioningProfiles.delete({ path: { id } }));

export const googleServiceAccountKeysQueryKey = (orgId: string) =>
  ["org", orgId, "google-service-account-keys"] as const;

export const googleServiceAccountKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: googleServiceAccountKeysQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.googleServiceAccountKeys.list(), signal),
    staleTime: 30_000,
  });

export const uploadGoogleServiceAccountKey = async (
  body: typeof UploadGoogleServiceAccountKeyBody.Type,
) => runApi((api) => api.googleServiceAccountKeys.upload({ payload: body }));

export const deleteGoogleServiceAccountKey = async (id: string) =>
  runApi((api) => api.googleServiceAccountKeys.delete({ path: { id } }));

export const iosBundleConfigurationsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "ios-bundle-configurations"] as const;

export const iosBundleConfigurationsQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: iosBundleConfigurationsQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.iosBundleConfigurations.list({ path: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createIosBundleConfiguration = async (
  projectId: string,
  body: typeof CreateIosBundleConfigurationBody.Type,
) => runApi((api) => api.iosBundleConfigurations.create({ path: { projectId }, payload: body }));

export const updateIosBundleConfiguration = async (
  id: string,
  body: typeof UpdateIosBundleConfigurationBody.Type,
) => runApi((api) => api.iosBundleConfigurations.update({ path: { id }, payload: body }));

export const deleteIosBundleConfiguration = async (id: string) =>
  runApi((api) => api.iosBundleConfigurations.delete({ path: { id } }));

export const iosAppMetadataQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "ios-app-metadata"] as const;

export const iosAppMetadataQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: iosAppMetadataQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.iosAppMetadata.list({ path: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createIosAppMetadata = async (
  projectId: string,
  body: typeof CreateIosAppMetadataBody.Type,
) => runApi((api) => api.iosAppMetadata.create({ path: { projectId }, payload: body }));

export const updateIosAppMetadata = async (
  id: string,
  body: typeof UpdateIosAppMetadataBody.Type,
) => runApi((api) => api.iosAppMetadata.update({ path: { id }, payload: body }));

export const deleteIosAppMetadata = async (id: string) =>
  runApi((api) => api.iosAppMetadata.delete({ path: { id } }));

export const androidApplicationIdentifiersQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "android-application-identifiers"] as const;

export const androidApplicationIdentifiersQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: androidApplicationIdentifiersQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.androidApplicationIdentifiers.list({ path: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createAndroidApplicationIdentifier = async (
  projectId: string,
  body: typeof CreateAndroidApplicationIdentifierBody.Type,
) =>
  runApi((api) => api.androidApplicationIdentifiers.create({ path: { projectId }, payload: body }));

export const deleteAndroidApplicationIdentifier = async (id: string) =>
  runApi((api) => api.androidApplicationIdentifiers.delete({ path: { id } }));

export const androidUploadKeystoresQueryKey = (orgId: string) =>
  ["org", orgId, "android-upload-keystores"] as const;

export const androidUploadKeystoresQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: androidUploadKeystoresQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.androidUploadKeystores.list(), signal),
    staleTime: 30_000,
  });

export const uploadAndroidUploadKeystore = async (
  body: typeof UploadAndroidUploadKeystoreBody.Type,
) => runApi((api) => api.androidUploadKeystores.upload({ payload: body }));

export const deleteAndroidUploadKeystore = async (id: string) =>
  runApi((api) => api.androidUploadKeystores.delete({ path: { id } }));

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
    queryFn: async ({ signal }) =>
      runApi(
        (api) => api.androidBuildCredentials.list({ path: { applicationIdentifierId } }),
        signal,
      ),
    staleTime: 30_000,
  });

export const createAndroidBuildCredentials = async (
  applicationIdentifierId: string,
  body: typeof CreateAndroidBuildCredentialsBody.Type,
) =>
  runApi((api) =>
    api.androidBuildCredentials.create({ path: { applicationIdentifierId }, payload: body }),
  );

export const updateAndroidBuildCredentials = async (
  id: string,
  body: typeof UpdateAndroidBuildCredentialsBody.Type,
) => runApi((api) => api.androidBuildCredentials.update({ path: { id }, payload: body }));

export const deleteAndroidBuildCredentials = async (id: string) =>
  runApi((api) => api.androidBuildCredentials.delete({ path: { id } }));
