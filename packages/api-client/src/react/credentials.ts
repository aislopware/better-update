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
  UploadApplePassTypeCertificateBody,
  UploadApplePayCertificateBody,
  UploadAppleProvisioningProfileBody,
  UploadApplePushCertificateBody,
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
  runApi((api) => api.appleDistributionCertificates.delete({ params: { id } }));

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
  runApi((api) => api.applePushKeys.delete({ params: { id } }));

export const applePushCertificatesQueryKey = (orgId: string) =>
  ["org", orgId, "apple-push-certificates"] as const;

export const applePushCertificatesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: applePushCertificatesQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.applePushCertificates.list(), signal),
    staleTime: 30_000,
  });

export const uploadApplePushCertificate = async (
  body: typeof UploadApplePushCertificateBody.Type,
) => runApi((api) => api.applePushCertificates.upload({ payload: body }));

export const deleteApplePushCertificate = async (id: string) =>
  runApi((api) => api.applePushCertificates.delete({ params: { id } }));

export const applePayCertificatesQueryKey = (orgId: string) =>
  ["org", orgId, "apple-pay-certificates"] as const;

export const applePayCertificatesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: applePayCertificatesQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.applePayCertificates.list(), signal),
    staleTime: 30_000,
  });

export const uploadApplePayCertificate = async (body: typeof UploadApplePayCertificateBody.Type) =>
  runApi((api) => api.applePayCertificates.upload({ payload: body }));

export const deleteApplePayCertificate = async (id: string) =>
  runApi((api) => api.applePayCertificates.delete({ params: { id } }));

export const applePassTypeCertificatesQueryKey = (orgId: string) =>
  ["org", orgId, "apple-pass-type-certificates"] as const;

export const applePassTypeCertificatesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: applePassTypeCertificatesQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.applePassTypeCertificates.list(), signal),
    staleTime: 30_000,
  });

export const uploadApplePassTypeCertificate = async (
  body: typeof UploadApplePassTypeCertificateBody.Type,
) => runApi((api) => api.applePassTypeCertificates.upload({ payload: body }));

export const deleteApplePassTypeCertificate = async (id: string) =>
  runApi((api) => api.applePassTypeCertificates.delete({ params: { id } }));

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
  runApi((api) => api.ascApiKeys.delete({ params: { id } }));

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
            query: {
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
  runApi((api) => api.appleProvisioningProfiles.delete({ params: { id } }));

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
  runApi((api) => api.googleServiceAccountKeys.delete({ params: { id } }));

export const iosBundleConfigurationsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "ios-bundle-configurations"] as const;

export const iosBundleConfigurationsQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: iosBundleConfigurationsQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.iosBundleConfigurations.list({ params: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createIosBundleConfiguration = async (
  projectId: string,
  body: typeof CreateIosBundleConfigurationBody.Type,
) => runApi((api) => api.iosBundleConfigurations.create({ params: { projectId }, payload: body }));

export const updateIosBundleConfiguration = async (
  id: string,
  body: typeof UpdateIosBundleConfigurationBody.Type,
) => runApi((api) => api.iosBundleConfigurations.update({ params: { id }, payload: body }));

export const deleteIosBundleConfiguration = async (id: string) =>
  runApi((api) => api.iosBundleConfigurations.delete({ params: { id } }));

export const iosAppMetadataQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "ios-app-metadata"] as const;

export const iosAppMetadataQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: iosAppMetadataQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.iosAppMetadata.list({ params: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createIosAppMetadata = async (
  projectId: string,
  body: typeof CreateIosAppMetadataBody.Type,
) => runApi((api) => api.iosAppMetadata.create({ params: { projectId }, payload: body }));

export const updateIosAppMetadata = async (
  id: string,
  body: typeof UpdateIosAppMetadataBody.Type,
) => runApi((api) => api.iosAppMetadata.update({ params: { id }, payload: body }));

export const deleteIosAppMetadata = async (id: string) =>
  runApi((api) => api.iosAppMetadata.delete({ params: { id } }));

export const androidApplicationIdentifiersQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "android-application-identifiers"] as const;

export const androidApplicationIdentifiersQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: androidApplicationIdentifiersQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.androidApplicationIdentifiers.list({ params: { projectId } }), signal),
    staleTime: 30_000,
  });

export const createAndroidApplicationIdentifier = async (
  projectId: string,
  body: typeof CreateAndroidApplicationIdentifierBody.Type,
) =>
  runApi((api) =>
    api.androidApplicationIdentifiers.create({ params: { projectId }, payload: body }),
  );

export const deleteAndroidApplicationIdentifier = async (id: string) =>
  runApi((api) => api.androidApplicationIdentifiers.delete({ params: { id } }));

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
  runApi((api) => api.androidUploadKeystores.delete({ params: { id } }));

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
        (api) => api.androidBuildCredentials.list({ params: { applicationIdentifierId } }),
        signal,
      ),
    staleTime: 30_000,
  });

export const createAndroidBuildCredentials = async (
  applicationIdentifierId: string,
  body: typeof CreateAndroidBuildCredentialsBody.Type,
) =>
  runApi((api) =>
    api.androidBuildCredentials.create({ params: { applicationIdentifierId }, payload: body }),
  );

export const updateAndroidBuildCredentials = async (
  id: string,
  body: typeof UpdateAndroidBuildCredentialsBody.Type,
) => runApi((api) => api.androidBuildCredentials.update({ params: { id }, payload: body }));

export const deleteAndroidBuildCredentials = async (id: string) =>
  runApi((api) => api.androidBuildCredentials.delete({ params: { id } }));

// Protection toggles (GITLAB-RBAC-SPEC §3b) — org admin only, idempotent.
// The team flag gates team-level interactions and seeds new child rows;
// each Apple child credential is gated by its own per-row flag.
export const setAppleTeamProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.appleTeams.protect({ params: { id } }))
    : runApi((api) => api.appleTeams.unprotect({ params: { id } }));

export const setAppleDistributionCertificateProtection = async (
  id: string,
  isProtected: boolean,
) =>
  isProtected
    ? runApi((api) => api.appleDistributionCertificates.protect({ params: { id } }))
    : runApi((api) => api.appleDistributionCertificates.unprotect({ params: { id } }));

export const setApplePushKeyProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.applePushKeys.protect({ params: { id } }))
    : runApi((api) => api.applePushKeys.unprotect({ params: { id } }));

export const setApplePushCertificateProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.applePushCertificates.protect({ params: { id } }))
    : runApi((api) => api.applePushCertificates.unprotect({ params: { id } }));

export const setApplePayCertificateProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.applePayCertificates.protect({ params: { id } }))
    : runApi((api) => api.applePayCertificates.unprotect({ params: { id } }));

export const setApplePassTypeCertificateProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.applePassTypeCertificates.protect({ params: { id } }))
    : runApi((api) => api.applePassTypeCertificates.unprotect({ params: { id } }));

export const setAppleProvisioningProfileProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.appleProvisioningProfiles.protect({ params: { id } }))
    : runApi((api) => api.appleProvisioningProfiles.unprotect({ params: { id } }));

export const setAscApiKeyProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.ascApiKeys.protect({ params: { id } }))
    : runApi((api) => api.ascApiKeys.unprotect({ params: { id } }));

export const setGoogleServiceAccountKeyProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.googleServiceAccountKeys.protect({ params: { id } }))
    : runApi((api) => api.googleServiceAccountKeys.unprotect({ params: { id } }));

export const setAndroidUploadKeystoreProtection = async (id: string, isProtected: boolean) =>
  isProtected
    ? runApi((api) => api.androidUploadKeystores.protect({ params: { id } }))
    : runApi((api) => api.androidUploadKeystores.unprotect({ params: { id } }));
