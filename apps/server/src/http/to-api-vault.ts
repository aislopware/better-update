import {
  AccountKey,
  AccountKeyEscrow,
  OrgEnvVaultKeyWrap,
  OrgVault,
  OrgVaultKeyWrap,
  UserEncryptionKey,
} from "@better-update/api";

import type {
  AccountKeyModel,
  OrgEnvVaultKeyWrapModel,
  OrgVaultKeyWrapModel,
  OrgVaultModel,
  UserEncryptionKeyModel,
} from "../vault-models";

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
    rotationPending: model.rotationPending,
    rotationPendingSince: model.rotationPendingSince,
    rotationPendingReason: model.rotationPendingReason,
    envVaultVersion: model.envVaultVersion,
    envRotationPending: model.envRotationPending,
    envRotationPendingSince: model.envRotationPendingSince,
    envRotationPendingReason: model.envRotationPendingReason,
    envVaultCutoverAt: model.envVaultCutoverAt,
  });

export const toApiOrgVaultKeyWrap = (model: OrgVaultKeyWrapModel): OrgVaultKeyWrap =>
  new OrgVaultKeyWrap({
    organizationId: model.organizationId,
    vaultVersion: model.vaultVersion,
    userEncryptionKeyId: model.userEncryptionKeyId,
    wrappedKey: model.wrappedKey,
    createdAt: model.createdAt,
  });

export const toApiOrgEnvVaultKeyWrap = (model: OrgEnvVaultKeyWrapModel): OrgEnvVaultKeyWrap =>
  new OrgEnvVaultKeyWrap({
    organizationId: model.organizationId,
    envVaultVersion: model.envVaultVersion,
    recipientKind: model.recipientKind,
    recipientId: model.recipientId,
    wrappedKey: model.wrappedKey,
    createdAt: model.createdAt,
  });

export const toApiAccountKey = (model: AccountKeyModel): AccountKey =>
  new AccountKey({
    id: model.id,
    userId: model.userId,
    agePublicKey: model.agePublicKey,
    ed25519PublicKey: model.ed25519PublicKey,
    fingerprint: model.fingerprint,
    createdAt: model.createdAt,
    lastUsedAt: model.lastUsedAt,
    revokedAt: model.revokedAt,
  });

/** The full escrow view, echoing the fixed v1 envelope constants the browser rebuilds with. */
export const toApiAccountKeyEscrow = (model: AccountKeyModel): AccountKeyEscrow =>
  new AccountKeyEscrow({
    id: model.id,
    version: 1,
    agePublicKey: model.agePublicKey,
    ed25519PublicKey: model.ed25519PublicKey,
    fingerprint: model.fingerprint,
    kdf: "argon2id",
    kdfParams: model.kdfParams,
    salt: model.salt,
    cipher: "xchacha20poly1305",
    escrowCt: model.escrowCt,
    createdAt: model.createdAt,
  });
