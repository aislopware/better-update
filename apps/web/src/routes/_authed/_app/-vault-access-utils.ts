import type {
  EncryptionKeyKindValue,
  UserEncryptionKeyItem,
  VaultRecipientItem,
} from "@better-update/api-client/react";

/** A device/recovery/machine kind, plus `unknown` for a wrap whose key the caller cannot see. */
export type RecipientKind = EncryptionKeyKindValue | "unknown";

export interface VaultRecipientRow {
  readonly userEncryptionKeyId: string;
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
  recovery: 2,
  unknown: 3,
};

/**
 * Join the vault wrap rows (the recipients that currently hold the key) with the
 * recipient public-key metadata, mirroring the CLI `credentials access list`:
 * iterate the wraps (the source of truth for "who can decrypt") and decorate each
 * with its key's label / kind / fingerprint. A wrap whose key is not visible to
 * the caller (e.g. another member's device) is kept as an `unknown` recipient so
 * the recipient count stays honest. Sorted by kind, then label.
 */
export const joinVaultRecipients = (
  recipients: readonly VaultRecipientItem[],
  keys: readonly UserEncryptionKeyItem[],
): VaultRecipientRow[] => {
  const byId = new Map(keys.map((key) => [key.id, key]));
  return recipients
    .map((recipient): VaultRecipientRow => {
      const key = byId.get(recipient.userEncryptionKeyId);
      return key
        ? {
            userEncryptionKeyId: recipient.userEncryptionKeyId,
            label: key.label,
            kind: key.kind,
            fingerprint: key.fingerprint,
            grantedAt: recipient.createdAt,
            lastUsedAt: key.lastUsedAt,
            revokedAt: key.revokedAt,
          }
        : {
            userEncryptionKeyId: recipient.userEncryptionKeyId,
            label: "Unknown key",
            kind: "unknown",
            fingerprint: null,
            grantedAt: recipient.createdAt,
            lastUsedAt: null,
            revokedAt: null,
          };
    })
    .toSorted(
      (left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.label.localeCompare(right.label),
    );
};

type RecipientBadgeVariant = "secondary" | "info" | "warning" | "outline";

/** Display label + badge variant per recipient kind; recovery/machine read distinctly from device. */
export const ENCRYPTION_KEY_KIND_META: Record<
  RecipientKind,
  { readonly label: string; readonly variant: RecipientBadgeVariant }
> = {
  device: { label: "Device", variant: "secondary" },
  machine: { label: "CI machine", variant: "info" },
  recovery: { label: "Recovery", variant: "warning" },
  unknown: { label: "Unknown", variant: "outline" },
};
