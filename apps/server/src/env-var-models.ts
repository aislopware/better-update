import type { EnvVarEnvironment, EnvVarScope, EnvVarVisibility } from "./models";

/**
 * Environment variable metadata — server-visible, holds no secret value. The
 * active value is the revision pointed at by {@link EnvVarModel.currentRevisionId}
 * ({@link EnvVarRevisionModel}). One row per (scope, key, environment).
 */
export interface EnvVarModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly scope: EnvVarScope;
  readonly environment: EnvVarEnvironment;
  readonly key: string;
  readonly visibility: EnvVarVisibility;
  readonly currentRevisionId: string | null;
  readonly revisionNumber: number | null;
  readonly revisionCount: number;
  readonly overridesGlobal?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One E2E-encrypted env var value revision. The server stores the opaque
 * ciphertext + wrapped DEK + vault version and never decrypts. `id` is the value
 * the CLI bound as `credentialId` when sealing (AAD), so a blob cannot be swapped
 * for another revision's.
 */
export interface EnvVarRevisionModel {
  readonly id: string;
  readonly envVarId: string;
  readonly organizationId: string;
  readonly revisionNumber: number;
  readonly valueCiphertext: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly createdByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
