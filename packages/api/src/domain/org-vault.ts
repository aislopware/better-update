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
  /**
   * Env-vault (EV) state from the two-vault split. `envVaultCutoverAt` is `null`
   * until the org forks its env values into a separate key; while `null`,
   * `envVaultVersion` is unused and env stays part of the credentials vault.
   */
  envVaultVersion: VaultVersion,
  envRotationPending: Schema.Boolean,
  envRotationPendingSince: Schema.NullOr(DateTimeString),
  envRotationPendingReason: Schema.NullOr(Schema.String),
  envVaultCutoverAt: Schema.NullOr(DateTimeString),
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
 * An env-vault recipient kind. Superset of the credentials-vault recipient kinds
 * plus `account` — the per-user account key the browser unwraps the env vault
 * with. `recipientId` references `user_encryption_keys.id` for the first three and
 * `account_keys.id` for `account` (polymorphic; see migration 0071). Defined here
 * (alongside `VaultWrapInput`) rather than in `env-vault.ts` so `BootstrapVaultBody`
 * can carry env wraps without a circular import (`env-vault.ts` → `org-vault.ts`).
 */
export const EnvVaultRecipientKind = Schema.Literal("device", "recovery", "machine", "account");
export type EnvVaultRecipientKind = typeof EnvVaultRecipientKind.Type;

/** One recipient's env-vault wrap row in a bootstrap / cutover / grant / rotate submission (age blob, base64). */
export const EnvVaultWrapInput = Schema.Struct({
  recipientKind: EnvVaultRecipientKind,
  recipientId: Id,
  wrappedKey: Schema.String.pipe(Schema.minLength(1)),
});

/**
 * Bootstrap the org vault: the initial credential-vault wrap rows AND the initial
 * env-vault wrap rows, each of which must include the uploader's own recipient and
 * the offline recovery recipient. Orgs are "born forked" — the env vault is set up
 * at bootstrap (server stamps the cutover + env version), so a separate
 * `env-vault migrate` step is never needed. `envWraps` is required: a client that
 * cannot produce them is too old to bootstrap.
 */
export const BootstrapVaultBody = Schema.Struct({
  wraps: Schema.Array(VaultWrapInput).pipe(Schema.minItems(1)),
  envWraps: Schema.Array(EnvVaultWrapInput).pipe(Schema.minItems(1)),
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
