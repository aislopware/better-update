import type { AccountKeyItem, UserEncryptionKeyItem } from "@better-update/api-client/react";

import {
  buildRecipientOwners,
  ENCRYPTION_KEY_KIND_META,
  joinEnvVaultRecipients,
  joinVaultRecipients,
} from "./-vault-access-utils";

import type { RecipientKind } from "./-vault-access-utils";

const makeKey = (
  overrides: Pick<UserEncryptionKeyItem, "id"> & Partial<UserEncryptionKeyItem>,
): UserEncryptionKeyItem => ({
  userId: "user-1",
  organizationId: null,
  kind: "device",
  publicKey: "age1example",
  label: "Key",
  fingerprint: "SHA256:abc",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

const OWNERS = buildRecipientOwners(
  [
    { userId: "user-1", user: { name: "Alice", email: "alice@example.com" } },
    { userId: "user-2", user: { name: "Bob", email: "bob@example.com" } },
  ],
  [
    { name: "gitlab-ci", userEncryptionKeyId: "ci" },
    { name: "vault-only robot", userEncryptionKeyId: null },
  ],
);

const NO_OWNERS = buildRecipientOwners([], []);

describe(joinVaultRecipients, () => {
  it("decorates each wrap with its key's label, kind, fingerprint, owner, and last-used", () => {
    const rows = joinVaultRecipients(
      [{ userEncryptionKeyId: "k1", createdAt: "2026-02-01T00:00:00.000Z" }],
      [
        makeKey({
          id: "k1",
          label: "Work laptop",
          kind: "device",
          fingerprint: "SHA256:zzz",
          lastUsedAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      OWNERS,
    );
    expect(rows).toStrictEqual([
      {
        recipientId: "k1",
        label: "Work laptop",
        kind: "device",
        owner: { name: "Alice", detail: "alice@example.com" },
        fingerprint: "SHA256:zzz",
        grantedAt: "2026-02-01T00:00:00.000Z",
        lastUsedAt: "2026-03-01T00:00:00.000Z",
        revokedAt: null,
      },
    ]);
  });

  it("binds machine keys to their robot and recovery keys to the organization", () => {
    const rows = joinVaultRecipients(
      [
        { userEncryptionKeyId: "ci", createdAt: "2026-01-01T00:00:00.000Z" },
        { userEncryptionKeyId: "rec", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      [
        makeKey({ id: "ci", kind: "machine", label: "gitlab-ci key", userId: null }),
        makeKey({ id: "rec", kind: "recovery", label: "Break-glass", userId: null }),
      ],
      OWNERS,
    );
    expect(rows.map((row) => row.owner)).toStrictEqual([
      { name: "gitlab-ci", detail: "CI robot" },
      { name: "Organization" },
    ]);
  });

  it("keeps a wrap whose key is not visible to the caller as an unknown recipient", () => {
    const [row] = joinVaultRecipients(
      [{ userEncryptionKeyId: "missing", createdAt: "2026-02-01T00:00:00.000Z" }],
      [],
      NO_OWNERS,
    );
    expect(row).toStrictEqual({
      recipientId: "missing",
      label: "Unknown key",
      kind: "unknown",
      owner: undefined,
      fingerprint: null,
      grantedAt: "2026-02-01T00:00:00.000Z",
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it("sorts by kind (device, machine, recovery, unknown) then label", () => {
    const rows = joinVaultRecipients(
      [
        { userEncryptionKeyId: "orphan", createdAt: "2026-01-01T00:00:00.000Z" },
        { userEncryptionKeyId: "rec", createdAt: "2026-01-01T00:00:00.000Z" },
        { userEncryptionKeyId: "ci", createdAt: "2026-01-01T00:00:00.000Z" },
        { userEncryptionKeyId: "dev-b", createdAt: "2026-01-01T00:00:00.000Z" },
        { userEncryptionKeyId: "dev-a", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      [
        makeKey({ id: "rec", kind: "recovery", label: "Break-glass" }),
        makeKey({ id: "ci", kind: "machine", label: "GitHub Actions" }),
        makeKey({ id: "dev-b", kind: "device", label: "Beta" }),
        makeKey({ id: "dev-a", kind: "device", label: "Alpha" }),
      ],
      NO_OWNERS,
    );
    expect(rows.map((row) => row.recipientId)).toStrictEqual([
      "dev-a",
      "dev-b",
      "ci",
      "rec",
      "orphan",
    ]);
  });
});

const makeAccountKey = (
  overrides: Pick<AccountKeyItem, "id"> & Partial<AccountKeyItem>,
): AccountKeyItem => ({
  userId: "user-1",
  agePublicKey: "age1example",
  ed25519PublicKey: "ed25519example",
  fingerprint: "SHA256:acct",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  ...overrides,
});

describe(joinEnvVaultRecipients, () => {
  it("resolves key wraps against encryption keys and account wraps against account keys", () => {
    const rows = joinEnvVaultRecipients(
      [
        {
          recipientKind: "account",
          recipientId: "acct-1",
          createdAt: "2026-02-02T00:00:00.000Z",
        },
        { recipientKind: "device", recipientId: "k1", createdAt: "2026-02-01T00:00:00.000Z" },
      ],
      [makeKey({ id: "k1", label: "Work laptop", fingerprint: "SHA256:zzz" })],
      [
        makeAccountKey({
          id: "acct-1",
          userId: "user-2",
          fingerprint: "SHA256:acct",
          lastUsedAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      OWNERS,
    );
    expect(rows).toStrictEqual([
      {
        recipientId: "k1",
        label: "Work laptop",
        kind: "device",
        owner: { name: "Alice", detail: "alice@example.com" },
        fingerprint: "SHA256:zzz",
        grantedAt: "2026-02-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
      {
        recipientId: "acct-1",
        label: "Bob's account key",
        kind: "account",
        owner: { name: "Bob", detail: "bob@example.com" },
        fingerprint: "SHA256:acct",
        grantedAt: "2026-02-02T00:00:00.000Z",
        lastUsedAt: "2026-03-01T00:00:00.000Z",
        revokedAt: null,
      },
    ]);
  });

  it("keeps an account wrap whose key is not visible as an unknown recipient", () => {
    const [row] = joinEnvVaultRecipients(
      [{ recipientKind: "account", recipientId: "gone", createdAt: "2026-02-01T00:00:00.000Z" }],
      [],
      [],
      NO_OWNERS,
    );
    expect(row?.kind).toBe("unknown");
    expect(row?.label).toBe("Unknown key");
  });
});

describe("encryption key kind metadata", () => {
  it("maps every recipient kind to a non-empty label", () => {
    const kinds: readonly RecipientKind[] = ["device", "machine", "account", "recovery", "unknown"];
    for (const kind of kinds) {
      expect(ENCRYPTION_KEY_KIND_META[kind].label.length).toBeGreaterThan(0);
    }
  });

  it("gives recovery, machine, and account recipients a look distinct from device", () => {
    expect(ENCRYPTION_KEY_KIND_META.device.variant).toBe("secondary");
    expect(ENCRYPTION_KEY_KIND_META.machine.variant).toBe("info");
    expect(ENCRYPTION_KEY_KIND_META.account.variant).toBe("info");
    expect(ENCRYPTION_KEY_KIND_META.recovery.variant).toBe("warning");
    expect(ENCRYPTION_KEY_KIND_META.unknown.variant).toBe("outline");
  });
});
