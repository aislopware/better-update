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

/** Who a recipient's access binds to: a member (name + email), a robot, or the org itself. */
export interface RecipientOwner {
  readonly name: string;
  readonly detail?: string;
}

export interface VaultRecipientRow {
  readonly recipientId: string;
  readonly label: string;
  readonly kind: RecipientKind;
  readonly owner: RecipientOwner | undefined;
  readonly fingerprint: string | null;
  readonly grantedAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

/** The minimal member shape the owner lookup needs (better-auth `listMembers` row). */
export interface MemberOwnerInput {
  readonly userId: string;
  readonly user: { readonly name: string; readonly email: string };
}

/** The minimal robot shape the owner lookup needs. */
export interface RobotOwnerInput {
  readonly name: string;
  readonly userEncryptionKeyId: string | null;
}

/** Pre-indexed owner lookups shared by both join functions. */
export interface RecipientOwners {
  readonly memberByUserId: ReadonlyMap<string, RecipientOwner>;
  readonly robotByKeyId: ReadonlyMap<string, RecipientOwner>;
}

const ORG_OWNER: RecipientOwner = { name: "Organization" };

/**
 * Index members and robots for the per-row owner lookup. Robots may be missing
 * (the caller may not be allowed to list them) — their machine keys then show no
 * owner rather than failing the page.
 */
export const buildRecipientOwners = (
  members: readonly MemberOwnerInput[],
  robots: readonly RobotOwnerInput[],
): RecipientOwners => ({
  memberByUserId: new Map(
    members.map((member) => [member.userId, { name: member.user.name, detail: member.user.email }]),
  ),
  robotByKeyId: new Map(
    robots.flatMap((robot) =>
      robot.userEncryptionKeyId === null
        ? []
        : [[robot.userEncryptionKeyId, { name: robot.name, detail: "CI robot" }] as const],
    ),
  ),
});

const keyOwner = (
  key: UserEncryptionKeyItem,
  owners: RecipientOwners,
): RecipientOwner | undefined => {
  if (key.kind === "recovery") {
    return ORG_OWNER;
  }
  if (key.kind === "machine") {
    return owners.robotByKeyId.get(key.id);
  }
  return key.userId === null ? undefined : owners.memberByUserId.get(key.userId);
};

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
  owner: undefined,
  fingerprint: null,
  grantedAt,
  lastUsedAt: null,
  revokedAt: null,
});

const encryptionKeyRow = (
  recipientId: string,
  grantedAt: string,
  key: UserEncryptionKeyItem | undefined,
  owners: RecipientOwners,
): VaultRecipientRow =>
  key
    ? {
        recipientId,
        label: key.label,
        kind: key.kind,
        owner: keyOwner(key, owners),
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
 * decrypt") and decorate each with its key's label / kind / fingerprint plus the
 * member/robot the access binds to. Sorted by kind, then label.
 */
export const joinVaultRecipients = (
  recipients: readonly VaultRecipientItem[],
  keys: readonly UserEncryptionKeyItem[],
  owners: RecipientOwners,
): VaultRecipientRow[] => {
  const byId = new Map(keys.map((key) => [key.id, key]));
  return sortRecipientRows(
    recipients.map((recipient) =>
      encryptionKeyRow(
        recipient.userEncryptionKeyId,
        recipient.createdAt,
        byId.get(recipient.userEncryptionKeyId),
        owners,
      ),
    ),
  );
};

/**
 * Join the ENV-vault wrap rows with their recipient metadata. Env recipients are
 * polymorphic: device/machine/recovery wraps resolve against the encryption keys,
 * `account` wraps against the members' browser account keys. An account key has
 * no user-chosen label, so it is named after its owning member ("<name>'s
 * account key"), falling back to a generic label when the member is not visible.
 */
export const joinEnvVaultRecipients = (
  recipients: readonly EnvVaultRecipientItem[],
  keys: readonly UserEncryptionKeyItem[],
  accountKeys: readonly AccountKeyItem[],
  owners: RecipientOwners,
): VaultRecipientRow[] => {
  const keyById = new Map(keys.map((key) => [key.id, key]));
  const accountById = new Map(accountKeys.map((account) => [account.id, account]));
  return sortRecipientRows(
    recipients.map((recipient) => {
      if (recipient.recipientKind === "account") {
        const account = accountById.get(recipient.recipientId);
        if (account === undefined) {
          return unknownRow(recipient.recipientId, recipient.createdAt);
        }
        const owner = owners.memberByUserId.get(account.userId);
        return {
          recipientId: recipient.recipientId,
          label: owner === undefined ? "Account key" : `${owner.name}'s account key`,
          kind: "account" as const,
          owner,
          fingerprint: account.fingerprint,
          grantedAt: recipient.createdAt,
          lastUsedAt: account.lastUsedAt,
          revokedAt: account.revokedAt,
        };
      }
      return encryptionKeyRow(
        recipient.recipientId,
        recipient.createdAt,
        keyById.get(recipient.recipientId),
        owners,
      );
    }),
  );
};

type RecipientBadgeVariant = "secondary" | "outline" | "info" | "warning";

/**
 * Display label + badge variant per recipient kind; recovery/machine/account read
 * distinctly from device.
 */
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
