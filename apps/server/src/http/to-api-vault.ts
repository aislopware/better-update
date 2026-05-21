import { OrgVault, OrgVaultKeyWrap, UserEncryptionKey } from "@better-update/api";

import type { OrgVaultKeyWrapModel, OrgVaultModel, UserEncryptionKeyModel } from "../models";

export const toApiUserEncryptionKey = (model: UserEncryptionKeyModel): UserEncryptionKey =>
  new UserEncryptionKey({
    id: model.id,
    userId: model.userId,
    organizationId: model.organizationId,
    kind: model.kind,
    publicKey: model.publicKey,
    label: model.label,
    fingerprint: model.fingerprint,
    createdAt: model.createdAt,
    lastUsedAt: model.lastUsedAt,
    revokedAt: model.revokedAt,
  });

export const toApiOrgVault = (model: OrgVaultModel): OrgVault =>
  new OrgVault({
    organizationId: model.organizationId,
    vaultVersion: model.vaultVersion,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiOrgVaultKeyWrap = (model: OrgVaultKeyWrapModel): OrgVaultKeyWrap =>
  new OrgVaultKeyWrap({
    organizationId: model.organizationId,
    vaultVersion: model.vaultVersion,
    userEncryptionKeyId: model.userEncryptionKeyId,
    wrappedKey: model.wrappedKey,
    createdAt: model.createdAt,
  });
