import type {
  AccountKeyItem,
  EncryptionKeyKindValue,
  EnvVaultRecipientItem,
  UserEncryptionKeyItem,
  VaultRecipientItem,
} from "@better-update/api-client/react";

/**
 * A device/recovery/machine kind, plus `account` for a browser account-key wrap
 * (env vault only) and `unknown` for a wrap whose key the caller cannot see.
 */
export type RecipientKind = EncryptionKeyKindValue | "account" | "unknown";

export interface VaultRecipientRow {
  readonly recipientId: string;
  readonly label: string;
  readonly kind: RecipientKind;
  readonly fingerprint: string | null;
  readonly grantedAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

const KIND_ORDER: Record<RecipientKind, number> = {
  device: 0,
  machine: 1,
  account: 2,
  recovery: 3,
  unknown: 4,
};

const sortRecipientRows = (rows: readonly VaultRecipientRow[]): VaultRecipientRow[] =>
  rows.toSorted(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.label.localeCompare(right.label),
  );

/** A wrap whose key is not visible to the caller — kept so the recipient count stays honest. */
const unknownRow = (recipientId: string, grantedAt: string): VaultRecipientRow => ({
  recipientId,
  label: "Unknown key",
  kind: "unknown",
  fingerprint: null,
  grantedAt,
  lastUsedAt: null,
  revokedAt: null,
});

const encryptionKeyRow = (
  recipientId: string,
  grantedAt: string,
  key: UserEncryptionKeyItem | undefined,
): VaultRecipientRow =>
  key
    ? {
        recipientId,
        label: key.label,
        kind: key.kind,
        fingerprint: key.fingerprint,
        grantedAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      }
    : unknownRow(recipientId, grantedAt);

/**
 * Join the credentials-vault wrap rows (the recipients that currently hold the
 * key) with the recipient public-key metadata, mirroring the CLI
 * `credentials access list`: iterate the wraps (the source of truth for "who can
 * decrypt") and decorate each with its key's label / kind / fingerprint. Sorted
 * by kind, then label.
 */
export const joinVaultRecipients = (
  recipients: readonly VaultRecipientItem[],
  keys: readonly UserEncryptionKeyItem[],
): VaultRecipientRow[] => {
  const byId = new Map(keys.map((key) => [key.id, key]));
  return sortRecipientRows(
    recipients.map((recipient) =>
      encryptionKeyRow(
        recipient.userEncryptionKeyId,
        recipient.createdAt,
        byId.get(recipient.userEncryptionKeyId),
      ),
    ),
  );
};

/**
 * Join the ENV-vault wrap rows with their recipient metadata. Env recipients are
 * polymorphic: device/machine/recovery wraps resolve against the encryption keys,
 * `account` wraps against the members' browser account keys (labelled generically —
 * an account key has no user-chosen label; the fingerprint identifies it).
 */
export const joinEnvVaultRecipients = (
  recipients: readonly EnvVaultRecipientItem[],
  keys: readonly UserEncryptionKeyItem[],
  accountKeys: readonly AccountKeyItem[],
): VaultRecipientRow[] => {
  const keyById = new Map(keys.map((key) => [key.id, key]));
  const accountById = new Map(accountKeys.map((account) => [account.id, account]));
  return sortRecipientRows(
    recipients.map((recipient) => {
      if (recipient.recipientKind === "account") {
        const account = accountById.get(recipient.recipientId);
        return account
          ? {
              recipientId: recipient.recipientId,
              label: "Account key",
              kind: "account" as const,
              fingerprint: account.fingerprint,
              grantedAt: recipient.createdAt,
              lastUsedAt: account.lastUsedAt,
              revokedAt: account.revokedAt,
            }
          : unknownRow(recipient.recipientId, recipient.createdAt);
      }
      return encryptionKeyRow(
        recipient.recipientId,
        recipient.createdAt,
        keyById.get(recipient.recipientId),
      );
    }),
  );
};

type RecipientBadgeVariant = "secondary" | "info" | "warning" | "outline";

/** Display label + badge variant per recipient kind; recovery/machine/account read distinctly from device. */
export const ENCRYPTION_KEY_KIND_META: Record<
  RecipientKind,
  { readonly label: string; readonly variant: RecipientBadgeVariant }
> = {
  device: { label: "Device", variant: "secondary" },
  machine: { label: "CI machine", variant: "info" },
  account: { label: "Account key", variant: "info" },
  recovery: { label: "Recovery", variant: "warning" },
  unknown: { label: "Unknown", variant: "outline" },
};
