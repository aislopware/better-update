import type { Selectable } from "kysely";

import type { OrgVaults } from "../db/schema";
import type { OrgVaultModel } from "../vault-models";

/** Every column of `org_vaults` (both vaults' version + rotation-pending state). */
export const VAULT_COLUMNS = [
  "organization_id",
  "vault_version",
  "created_at",
  "updated_at",
  "rotation_pending",
  "rotation_pending_since",
  "rotation_pending_reason",
  "env_vault_version",
  "env_rotation_pending",
  "env_rotation_pending_since",
  "env_rotation_pending_reason",
  "env_vault_cutover_at",
] as const;

/** Map an `org_vaults` row to the domain model (both credentials + env vault state). */
export const toVaultModel = (
  row: Selectable<OrgVaults>,
  organizationId: string,
): OrgVaultModel => ({
  organizationId,
  vaultVersion: row.vault_version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  rotationPending: row.rotation_pending !== 0,
  rotationPendingSince: row.rotation_pending_since,
  rotationPendingReason: row.rotation_pending_reason,
  envVaultVersion: row.env_vault_version,
  envRotationPending: row.env_rotation_pending !== 0,
  envRotationPendingSince: row.env_rotation_pending_since,
  envRotationPendingReason: row.env_rotation_pending_reason,
  envVaultCutoverAt: row.env_vault_cutover_at,
});
