// Domain models for the end-to-end-encrypted credential vault: recipient keys,
// the per-org vault + its key wraps, and the credential/DEK references a rotation
// must cover. Split out of `models.ts` (mirrors `env-var-models.ts`) so neither
// file outgrows the line cap. `EncryptionKeyKind` stays in `models.ts` — it is a
// shared primitive also used to narrow the DB schema overlay.
import type { EncryptionKeyKind } from "./models";

/**
 * Recipient kinds for an env-vault key wrap. Superset of {@link EncryptionKeyKind}
 * plus `account` — the per-user account key the browser unwraps the env vault with.
 * The wrap row's `recipient_id` points at `user_encryption_keys.id` for the first
 * three and `account_keys.id` for `account` (polymorphic; see migration 0071).
 */
export type EnvVaultRecipientKind = EncryptionKeyKind | "account";

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

/** Argon2id cost parameters stored (as JSON) in an account-key escrow header. */
export interface AccountKeyKdfParams {
  readonly time: number;
  readonly memory: number;
  readonly parallelism: number;
}

/**
 * A per-user account key: the age recipient the browser unwraps the env vault
 * with, plus the passphrase-sealed escrow holding the private halves. Cross-org
 * like a device key (one identity, many orgs via per-org env-vault wraps). The
 * server stores the escrow opaquely and can never open it.
 */
export interface AccountKeyModel {
  readonly id: string;
  readonly userId: string;
  readonly agePublicKey: string;
  readonly ed25519PublicKey: string;
  readonly escrowCt: string;
  readonly salt: string;
  readonly kdfParams: AccountKeyKdfParams;
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
   * CREDENTIALS-vault key is considered compromised-on-departure and must be
   * rotated. While `true`, credential-download paths (build-credentials.resolve)
   * fail closed; `rotate` clears it. See docs/specs/build/10-vault-lifecycle-revocation.md.
   */
  readonly rotationPending: boolean;
  readonly rotationPendingSince: string | null;
  readonly rotationPendingReason: string | null;
  /**
   * Env-vault (EV) state — the second vault from the two-vault split (spec 11).
   * `envVaultCutoverAt` is the fork sentinel: `null` ⇒ env values are still part
   * of the credentials vault (legacy, pre-cutover) and `envVaultVersion` is unused;
   * a timestamp ⇒ env was forked to its own key at `envVaultVersion`.
   */
  readonly envVaultVersion: number;
  readonly envRotationPending: boolean;
  readonly envRotationPendingSince: string | null;
  readonly envRotationPendingReason: string | null;
  readonly envVaultCutoverAt: string | null;
}

/** Has the org forked its env values into a separate env vault? */
export const isEnvVaultForked = (vault: OrgVaultModel): boolean => vault.envVaultCutoverAt !== null;

export interface OrgVaultKeyWrapModel {
  readonly organizationId: string;
  readonly vaultVersion: number;
  readonly userEncryptionKeyId: string;
  readonly wrappedKey: string;
  readonly createdAt: string;
}

/**
 * One wrap of the ENV-vault key to a recipient. Unlike {@link OrgVaultKeyWrapModel},
 * the recipient is polymorphic: `recipientKind` selects the source table for
 * `recipientId` (`user_encryption_keys.id` for device/recovery/machine, or
 * `account_keys.id` for `account`).
 */
export interface OrgEnvVaultKeyWrapModel {
  readonly organizationId: string;
  readonly envVaultVersion: number;
  readonly recipientKind: EnvVaultRecipientKind;
  readonly recipientId: string;
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
  | "applePushCertificate"
  | "applePayCertificate"
  | "applePassTypeCertificate"
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
