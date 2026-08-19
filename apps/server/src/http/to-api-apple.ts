// Apple credential mappers, extracted from ./to-api for the max-lines budget
// (mirroring ./to-api-submission) and re-exported there so existing import
// sites stay stable.

import { safeJsonParse } from "@better-update/safe-json";

import type {
  AppleDistributionCertificate,
  ApplePassTypeCertificate,
  ApplePayCertificate,
  AppleProvisioningProfile,
  ApplePushCertificate,
  ApplePushKey,
  AppleTeam,
  AscApiKey,
} from "@better-update/api";

import type {
  AppleDistributionCertificateModel,
  ApplePassTypeCertificateModel,
  ApplePayCertificateModel,
  AppleProvisioningProfileModel,
  ApplePushCertificateModel,
  ApplePushKeyModel,
  AscApiKeyModel,
} from "../models";
import type { AppleTeamWithCounts } from "../repositories/apple-teams";

export const toApiAppleTeamWithCounts = (
  team: AppleTeamWithCounts,
  boundProjectIds: readonly string[],
  boundToAllProjects = false,
): AppleTeam => ({
  boundProjectIds,
  boundToAllProjects,
  id: team.id,
  organizationId: team.organizationId,
  appleTeamId: team.appleTeamId,
  appleTeamType: team.appleTeamType,
  name: team.name,
  protected: team.isProtected,
  distributionCertificateCount: team.distributionCertificateCount,
  pushKeyCount: team.pushKeyCount,
  ascApiKeyCount: team.ascApiKeyCount,
  provisioningProfileCount: team.provisioningProfileCount,
  deviceCount: team.deviceCount,
  createdAt: team.createdAt,
  updatedAt: team.updatedAt,
});

export const toApiAppleDistributionCertificate = (
  model: AppleDistributionCertificateModel,
): AppleDistributionCertificate => ({
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  serialNumber: model.serialNumber,
  certificateType: model.certificateType,
  developerIdIdentifier: model.developerIdIdentifier,
  validFrom: model.validFrom,
  validUntil: model.validUntil,
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export const toApiApplePushKey = (model: ApplePushKeyModel): ApplePushKey => ({
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  keyId: model.keyId,
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export const toApiApplePushCertificate = (
  model: ApplePushCertificateModel,
): ApplePushCertificate => ({
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  bundleIdentifier: model.bundleIdentifier,
  serialNumber: model.serialNumber,
  validFrom: model.validFrom,
  validUntil: model.validUntil,
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export const toApiApplePayCertificate = (model: ApplePayCertificateModel): ApplePayCertificate => ({
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  merchantIdentifier: model.merchantIdentifier,
  serialNumber: model.serialNumber,
  validFrom: model.validFrom,
  validUntil: model.validUntil,
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export const toApiApplePassTypeCertificate = (
  model: ApplePassTypeCertificateModel,
): ApplePassTypeCertificate => ({
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  passTypeIdentifier: model.passTypeIdentifier,
  serialNumber: model.serialNumber,
  validFrom: model.validFrom,
  validUntil: model.validUntil,
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

const parseRoles = (roles: string): readonly string[] => {
  const parsed = safeJsonParse(roles);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value): value is string => typeof value === "string");
};

export const toApiAscApiKey = (
  model: AscApiKeyModel,
  boundProjectIds: readonly string[],
  // Team-scoped keys inherit their TEAM's org-wide flag (cascade, spec §1a).
  boundToAllProjects = false,
): AscApiKey => ({
  boundProjectIds,
  boundToAllProjects,
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  keyId: model.keyId,
  issuerId: model.issuerId,
  name: model.name,
  roles: parseRoles(model.roles),
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export const toApiAppleProvisioningProfile = (
  model: AppleProvisioningProfileModel,
): AppleProvisioningProfile => ({
  id: model.id,
  organizationId: model.organizationId,
  appleTeamId: model.appleTeamId,
  appleDistributionCertificateId: model.appleDistributionCertificateId,
  bundleIdentifier: model.bundleIdentifier,
  distributionType: model.distributionType,
  developerPortalIdentifier: model.developerPortalIdentifier,
  profileName: model.profileName,
  validUntil: model.validUntil,
  protected: model.isProtected,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});
