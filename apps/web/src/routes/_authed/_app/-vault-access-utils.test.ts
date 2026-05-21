import type { UserEncryptionKeyItem } from "@better-update/api-client/react";

import { ENCRYPTION_KEY_KIND_META, joinVaultRecipients } from "./-vault-access-utils";

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

describe(joinVaultRecipients, () => {
  it("decorates each wrap with its key's label, kind, fingerprint, and last-used", () => {
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
    );
    expect(rows).toStrictEqual([
      {
        userEncryptionKeyId: "k1",
        label: "Work laptop",
        kind: "device",
        fingerprint: "SHA256:zzz",
        lastUsedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
  });

  it("keeps a wrap whose key is not visible to the caller as an unknown recipient", () => {
    const [row] = joinVaultRecipients(
      [{ userEncryptionKeyId: "missing", createdAt: "2026-02-01T00:00:00.000Z" }],
      [],
    );
    expect(row).toStrictEqual({
      userEncryptionKeyId: "missing",
      label: "Unknown key",
      kind: "unknown",
      fingerprint: null,
      lastUsedAt: null,
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
    );
    expect(rows.map((row) => row.userEncryptionKeyId)).toStrictEqual([
      "dev-a",
      "dev-b",
      "ci",
      "rec",
      "orphan",
    ]);
  });
});

describe("encryption key kind metadata", () => {
  it("maps every recipient kind to a non-empty label", () => {
    const kinds: readonly RecipientKind[] = ["device", "machine", "recovery", "unknown"];
    for (const kind of kinds) {
      expect(ENCRYPTION_KEY_KIND_META[kind].label.length).toBeGreaterThan(0);
    }
  });

  it("gives recovery and machine recipients a variant distinct from device", () => {
    expect(ENCRYPTION_KEY_KIND_META.device.variant).toBe("secondary");
    expect(ENCRYPTION_KEY_KIND_META.machine.variant).toBe("info");
    expect(ENCRYPTION_KEY_KIND_META.recovery.variant).toBe("warning");
    expect(ENCRYPTION_KEY_KIND_META.unknown.variant).toBe("outline");
  });
});
