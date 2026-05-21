import { Schema } from "effect";

import { Id } from "./common";
import { VaultVersion, VaultWrapInput } from "./org-vault";

/** Base64 XChaCha20-Poly1305 ciphertext (`nonce ‖ ciphertext ‖ tag`) of a credential payload. */
export const Ciphertext = Schema.String.pipe(Schema.minLength(1)).annotations({
  description: "Base64 XChaCha20-Poly1305 ciphertext of the credential payload",
});

/** Base64 of the per-credential DEK wrapped under the org vault key (AAD-bound). */
export const WrappedDek = Schema.String.pipe(Schema.minLength(1)).annotations({
  description: "Base64 of the DEK wrapped under the org vault key",
});

/**
 * The secret-credential kinds whose DEK is wrapped under the org vault key — the
 * five tables a rotation must re-wrap. Provisioning profiles are plaintext and
 * are deliberately absent.
 */
export const CredentialType = Schema.Literal(
  "appleDistributionCertificate",
  "applePushKey",
  "ascApiKey",
  "googleServiceAccountKey",
  "androidUploadKeystore",
).annotations({
  description: "Which encrypted-credential table a vault-key DEK re-wrap targets",
});

/**
 * The client-encrypted envelope. Spread into each secret credential's upload
 * body and download result alongside that credential's public metadata. The
 * server stores these opaque values, relays the ciphertext to/from R2, and
 * never decrypts them.
 */
export const encryptedEnvelopeFields = {
  ciphertext: Ciphertext,
  wrappedDek: WrappedDek,
  vaultVersion: VaultVersion,
} as const;

/**
 * One credential's DEK re-wrapped under the new vault key during a rotation. The
 * client unwraps each DEK with the old vault key and re-wraps it under the new
 * one; the server stores the opaque blob and never sees the DEK.
 */
export const CredentialDekUpdate = Schema.Struct({
  credentialType: CredentialType,
  credentialId: Id,
  wrappedDek: WrappedDek,
});

/**
 * Rotate (or revoke) the org vault key. The client generates a new vault key at
 * version `fromVersion + 1`, re-wraps every credential DEK under it, and
 * re-wraps the new key to each surviving recipient (a revoke just omits the
 * dropped recipient). Defined here rather than in `org-vault` because it spans
 * both vault wraps and credential DEKs, while `org-vault` stays
 * credential-agnostic. The server applies it atomically with compare-and-swap on
 * `fromVersion` and rejects any submission that does not re-wrap every credential
 * at the current version.
 */
export const RotateVaultBody = Schema.Struct({
  fromVersion: VaultVersion,
  recipientWraps: Schema.Array(VaultWrapInput).pipe(Schema.minItems(1)),
  credentialDeks: Schema.Array(CredentialDekUpdate),
});
