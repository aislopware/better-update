// Domain models for the end-to-end-encrypted credential vault: recipient keys,
// the per-org vault + its key wraps, and the credential/DEK references a rotation
// must cover. Split out of `models.ts` (mirrors `env-var-models.ts`) so neither
// file outgrows the line cap. `EncryptionKeyKind` stays in `models.ts` — it is a
// shared primitive also used to narrow the DB schema overlay.
import type { EncryptionKeyKind } from "./models";

export interface UserEncryptionKeyModel {
  readonly id: string;
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly kind: EncryptionKeyKind;
  readonly publicKey: string;
  readonly label: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface OrgVaultModel {
  readonly organizationId: string;
  readonly vaultVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * A recipient was dropped out-of-band (member removed / downgraded) so the live
   * vault key is considered compromised-on-departure and must be rotated. While
   * `true`, credential-download paths (build-credentials.resolve, env-vars.export)
   * fail closed; `rotate` clears it. See docs/specs/build/10-vault-lifecycle-revocation.md.
   */
  readonly rotationPending: boolean;
  readonly rotationPendingSince: string | null;
  readonly rotationPendingReason: string | null;
}

export interface OrgVaultKeyWrapModel {
  readonly organizationId: string;
  readonly vaultVersion: number;
  readonly userEncryptionKeyId: string;
  readonly wrappedKey: string;
  readonly createdAt: string;
}

/**
 * The secret kinds whose DEK is wrapped under the org vault key — the rows a
 * rotation must re-wrap. Besides the five signing credentials, each environment
 * variable value revision is its own E2E-encrypted secret bound to the vault.
 */
export type EncryptedCredentialType =
  | "appleDistributionCertificate"
  | "applePushKey"
  | "ascApiKey"
  | "googleServiceAccountKey"
  | "androidUploadKeystore"
  | "envVarValue";

/** A credential row's identity for rotation coverage (type + id, version-agnostic). */
export interface CredentialRef {
  readonly credentialType: EncryptedCredentialType;
  readonly id: string;
}

/** A credential row's currently-wrapped DEK — the source the client re-wraps in a rotation. */
export interface CredentialDekRefModel {
  readonly credentialType: EncryptedCredentialType;
  readonly credentialId: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}
