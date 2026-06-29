import { Schema } from "effect";

import { DateTimeString, Id } from "./common";
import { WrappedDek } from "./encrypted-credential";
import { VaultVersion } from "./org-vault";

/**
 * An env-vault recipient kind. Superset of the credentials-vault recipient kinds
 * plus `account` — the per-user account key the browser unwraps the env vault
 * with. `recipientId` references `user_encryption_keys.id` for the first three and
 * `account_keys.id` for `account` (polymorphic; see migration 0071).
 */
export const EnvVaultRecipientKind = Schema.Literal("device", "recovery", "machine", "account");
export type EnvVaultRecipientKind = typeof EnvVaultRecipientKind.Type;

/** One wrap of the env-vault key to a recipient (an opaque `age` blob). */
export class OrgEnvVaultKeyWrap extends Schema.Class<OrgEnvVaultKeyWrap>("OrgEnvVaultKeyWrap")({
  organizationId: Id,
  envVaultVersion: VaultVersion,
  recipientKind: EnvVaultRecipientKind,
  recipientId: Id,
  wrappedKey: Schema.String,
  createdAt: DateTimeString,
}) {}

/** The wrapped env-vault key for the calling recipient — fetched, then unwrapped client-side. */
export const RecipientEnvVaultKey = Schema.Struct({
  envVaultVersion: VaultVersion,
  wrappedKey: Schema.String,
});

/** A recipient currently holding the env-vault key (kind + id + when wrapped). */
export const EnvVaultRecipientRef = Schema.Struct({
  recipientKind: EnvVaultRecipientKind,
  recipientId: Id,
  createdAt: DateTimeString,
});

/** Every recipient holding the env-vault key at the current version. */
export const EnvVaultRecipients = Schema.Struct({
  envVaultVersion: VaultVersion,
  recipients: Schema.Array(EnvVaultRecipientRef),
});

/** One recipient's wrap row in a cutover / grant / rotate submission (age blob, base64). */
export const EnvVaultWrapInput = Schema.Struct({
  recipientKind: EnvVaultRecipientKind,
  recipientId: Id,
  wrappedKey: Schema.String.pipe(Schema.minLength(1)),
});

/** Add a single env wrap at the current env version (grant or self-link). */
export const AddEnvVaultWrapBody = Schema.Struct({
  envVaultVersion: VaultVersion,
  wrap: EnvVaultWrapInput,
});

/** One env-var revision's DEK re-wrapped under the env-vault key (cutover/rotation). */
export const EnvVaultDekUpdate = Schema.Struct({
  credentialId: Id,
  wrappedDek: WrappedDek,
});

/** One env-var revision's currently-stored wrapped DEK + version (the rotation source). */
export const EnvVaultDekRef = Schema.Struct({
  credentialId: Id,
  wrappedDek: WrappedDek,
  vaultVersion: VaultVersion,
});

/** Every wrapped env DEK + the current env-vault version (the rotation source set). */
export const EnvVaultCredentialDeks = Schema.Struct({
  envVaultVersion: VaultVersion,
  deks: Schema.Array(EnvVaultDekRef),
});

/**
 * The one-shot cutover: fork the org's env values into a separate env vault. The
 * client generates the env key, wraps it to every recipient (device/recovery/
 * machine + each member's account key), and re-keys every env DEK from the
 * credentials key to the env key. Must include an offline recovery recipient and
 * re-key every env-var revision.
 */
export const CutoverEnvVaultBody = Schema.Struct({
  wraps: Schema.Array(EnvVaultWrapInput).pipe(Schema.minItems(1)),
  envDeks: Schema.Array(EnvVaultDekUpdate),
});

/**
 * Rotate (or revoke) the env-vault key. The client generates a new key at
 * `fromVersion + 1`, re-wraps every env DEK under it, and re-wraps the new key to
 * the surviving recipients. Applied atomically with compare-and-swap on
 * `fromVersion`; must re-key every env-var revision.
 */
export const RotateEnvVaultBody = Schema.Struct({
  fromVersion: VaultVersion,
  wraps: Schema.Array(EnvVaultWrapInput).pipe(Schema.minItems(1)),
  envDeks: Schema.Array(EnvVaultDekUpdate),
});
