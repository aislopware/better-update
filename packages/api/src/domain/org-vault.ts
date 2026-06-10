import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

/** Monotonic per-org vault key version; bumped on every rotation. */
export const VaultVersion = Schema.Number.pipe(Schema.int(), Schema.positive()).annotations({
  description: "Monotonic org vault key version (incremented on each rotation)",
});

/**
 * The authoritative current vault version for an organization. Upload and
 * rotation both carry the version they read; the server accepts a write only if
 * it still matches (compare-and-swap).
 */
export class OrgVault extends Schema.Class<OrgVault>("OrgVault")({
  organizationId: Id,
  vaultVersion: VaultVersion,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
  /**
   * A recipient was dropped out-of-band (member removed/downgraded); the live key
   * is considered compromised and must be rotated. While true, credential-download
   * paths fail closed (409). `rotate` clears it.
   */
  rotationPending: Schema.Boolean,
  rotationPendingSince: Schema.NullOr(DateTimeString),
  rotationPendingReason: Schema.NullOr(Schema.String),
}) {}

/**
 * One wrap of the org vault key to a recipient's public key — an `age` blob the
 * server stores opaque (it can never unwrap it). One row per recipient.
 */
export class OrgVaultKeyWrap extends Schema.Class<OrgVaultKeyWrap>("OrgVaultKeyWrap")({
  organizationId: Id,
  vaultVersion: VaultVersion,
  userEncryptionKeyId: Id,
  wrappedKey: Schema.String,
  createdAt: DateTimeString,
}) {}

/** The wrapped vault key for the calling recipient — fetched, then unwrapped client-side. */
export const RecipientVaultKey = Schema.Struct({
  vaultVersion: VaultVersion,
  wrappedKey: Schema.String,
});

/**
 * A recipient currently holding the vault key (just the key id + when it was
 * wrapped). The opaque `wrappedKey` is deliberately omitted — the Access view
 * joins this with the encryption-key list for fingerprints/labels, and rotation
 * re-wraps from each recipient's public key, so neither needs the blob.
 */
export const VaultRecipientRef = Schema.Struct({
  userEncryptionKeyId: Id,
  createdAt: DateTimeString,
});

/** Every recipient holding the vault key at the current version. */
export const VaultRecipients = Schema.Struct({
  vaultVersion: VaultVersion,
  recipients: Schema.Array(VaultRecipientRef),
});

/** One recipient's wrap row in a bootstrap / grant / rotate submission (age blob, base64). */
export const VaultWrapInput = Schema.Struct({
  userEncryptionKeyId: Id,
  wrappedKey: Schema.String.pipe(Schema.minLength(1)),
});

/**
 * Bootstrap the org vault on the first upload: the initial wrap rows, which must
 * include the uploader's own recipient and the offline recovery recipient.
 */
export const BootstrapVaultBody = Schema.Struct({
  wraps: Schema.Array(VaultWrapInput).pipe(Schema.minItems(1)),
});

/**
 * Add a single wrap row at the current vault version (grant another user, or
 * self-link your own device). Authz is enforced server-side; the wrap itself is
 * opaque and only decryptable if produced with the real vault key.
 */
export const AddVaultWrapBody = Schema.Struct({
  vaultVersion: VaultVersion,
  wrap: VaultWrapInput,
});
