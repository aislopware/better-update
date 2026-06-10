import { env } from "cloudflare:test";
import { Effect, Either } from "effect";

import { OrgVaultRepo, OrgVaultRepoLive } from "../../../src/repositories/org-vault";
import { runEitherWithLayerAndEnv, runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, OrgVaultRepo>) =>
  runWithLayerAndEnv(effect, OrgVaultRepoLive, env);

const runEither = <Ret, Err>(effect: Effect.Effect<Ret, Err, OrgVaultRepo>) =>
  runEitherWithLayerAndEnv(effect, OrgVaultRepoLive, env);

const insertOrg = (id: string, slug: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, `Org ${slug}`, slug, "2026-01-01T00:00:00Z")
    .run();

// Org-owned keys (recovery/machine) only need the org FK and satisfy the table
// CHECK without seeding the user table — enough to back a wrap's FK in repo tests.
const insertOrgKey = (id: string, organizationId: string, kind: "recovery" | "machine") =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys" ("id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at") VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      organizationId,
      kind,
      `age1${id}`,
      `Key ${id}`,
      `SHA256:${id}`,
      "2026-01-01T00:00:00Z",
    )
    .run();

const countWraps = async (organizationId: string, userEncryptionKeyId: string) => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM "org_vault_key_wraps" WHERE "organization_id" = ? AND "user_encryption_key_id" = ?`,
  )
    .bind(organizationId, userEncryptionKeyId)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

const insertUser = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, `User ${id}`, `${id}@example.com`, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
    .run();

// A device key is user-owned (user_id set, organization_id NULL per the table CHECK).
const insertDeviceKey = (id: string, userId: string) =>
  env.DB.prepare(
    `INSERT INTO "user_encryption_keys" ("id", "user_id", "organization_id", "kind", "public_key", "label", "fingerprint", "created_at") VALUES (?, ?, NULL, 'device', ?, ?, ?, ?)`,
  )
    .bind(id, userId, `age1${id}`, `Key ${id}`, `SHA256:${id}`, "2026-01-01T00:00:00Z")
    .run();

const keyRevokedAt = async (id: string) => {
  const row = await env.DB.prepare(`SELECT "revoked_at" FROM "user_encryption_keys" WHERE "id" = ?`)
    .bind(id)
    .first<{ revoked_at: string | null }>();
  return row?.revoked_at ?? null;
};

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await insertOrg("ov-empty", "ov-empty");
  await insertOrg("ov-boot", "ov-boot");
  await insertOrg("ov-cas", "ov-cas");
  await insertOrgKey("ov-boot-r", "ov-boot", "recovery");
  await insertOrgKey("ov-boot-m", "ov-boot", "machine");
  await insertOrgKey("ov-cas-r", "ov-cas", "recovery");
  await insertOrgKey("ov-cas-m", "ov-cas", "machine");
  await insertOrgKey("ov-cas-m2", "ov-cas", "machine");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("OrgVaultRepo — D1 integration", () => {
  describe("getVault", () => {
    it("returns null before bootstrap", async () => {
      const vault = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.getVault({ organizationId: "ov-empty" });
        }),
      );
      expect(vault).toBeNull();
    });
  });

  describe("bootstrap", () => {
    it("persists vault v1 with its initial wraps", async () => {
      const vault = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.bootstrap({
            organizationId: "ov-boot",
            wraps: [
              { userEncryptionKeyId: "ov-boot-r", wrappedKey: "wrap-recovery" },
              { userEncryptionKeyId: "ov-boot-m", wrappedKey: "wrap-machine" },
            ],
            now: "2026-02-01T00:00:00Z",
          });
        }),
      );

      expect(vault.vaultVersion).toBe(1);
      expect(vault.organizationId).toBe("ov-boot");
      expect(await countWraps("ov-boot", "ov-boot-r")).toBe(1);
      expect(await countWraps("ov-boot", "ov-boot-m")).toBe(1);

      const reread = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.getVault({ organizationId: "ov-boot" });
        }),
      );
      expect(reread?.vaultVersion).toBe(1);
    });

    it("returns Conflict when the org vault already exists", async () => {
      const result = await runEither(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.bootstrap({
            organizationId: "ov-boot",
            wraps: [{ userEncryptionKeyId: "ov-boot-r", wrappedKey: "again" }],
            now: "2026-02-02T00:00:00Z",
          });
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });
  });

  describe("addWrap (compare-and-swap)", () => {
    beforeAll(async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          yield* repo.bootstrap({
            organizationId: "ov-cas",
            wraps: [{ userEncryptionKeyId: "ov-cas-r", wrappedKey: "cas-recovery" }],
            now: "2026-02-01T00:00:00Z",
          });
        }),
      );
    });

    it("inserts a wrap when the version matches", async () => {
      const wrap = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.addWrap({
            organizationId: "ov-cas",
            vaultVersion: 1,
            userEncryptionKeyId: "ov-cas-m",
            wrappedKey: "cas-machine",
            now: "2026-02-03T00:00:00Z",
          });
        }),
      );
      expect(wrap.userEncryptionKeyId).toBe("ov-cas-m");
      expect(wrap.vaultVersion).toBe(1);
      expect(await countWraps("ov-cas", "ov-cas-m")).toBe(1);
    });

    it("rejects a stale version with Conflict and inserts nothing", async () => {
      const result = await runEither(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.addWrap({
            organizationId: "ov-cas",
            vaultVersion: 2, // current is 1 — stale
            userEncryptionKeyId: "ov-cas-m2",
            wrappedKey: "should-not-persist",
            now: "2026-02-04T00:00:00Z",
          });
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
      // The CAS guard must have prevented the insert entirely.
      expect(await countWraps("ov-cas", "ov-cas-m2")).toBe(0);
    });

    it("rejects a duplicate recipient at the same version with Conflict", async () => {
      const result = await runEither(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.addWrap({
            organizationId: "ov-cas",
            vaultVersion: 1,
            userEncryptionKeyId: "ov-cas-r", // already wrapped at v1 via bootstrap
            wrappedKey: "duplicate",
            now: "2026-02-05T00:00:00Z",
          });
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
    });
  });

  describe("findWrap & listWraps", () => {
    it("findWrap returns the wrap at the current version, null otherwise", async () => {
      const [present, wrongVersion, unknownKey] = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* Effect.all([
            repo.findWrap({
              organizationId: "ov-cas",
              vaultVersion: 1,
              userEncryptionKeyId: "ov-cas-r",
            }),
            repo.findWrap({
              organizationId: "ov-cas",
              vaultVersion: 2,
              userEncryptionKeyId: "ov-cas-r",
            }),
            repo.findWrap({
              organizationId: "ov-cas",
              vaultVersion: 1,
              userEncryptionKeyId: "ov-cas-m2",
            }),
          ]);
        }),
      );
      expect(present?.wrappedKey).toBe("cas-recovery");
      expect(wrongVersion).toBeNull();
      expect(unknownKey).toBeNull();
    });

    it("listWraps returns every recipient at the version", async () => {
      const wraps = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.listWraps({ organizationId: "ov-cas", vaultVersion: 1 });
        }),
      );
      const ids = wraps.map((wrap) => wrap.userEncryptionKeyId);
      expect(ids).toContain("ov-cas-r");
      expect(ids).toContain("ov-cas-m");
      expect(ids).not.toContain("ov-cas-m2");
    });
  });

  describe("rotate (atomic re-key)", () => {
    const getVersion = (organizationId: string) =>
      run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          const vault = yield* repo.getVault({ organizationId });
          return vault?.vaultVersion ?? null;
        }),
      );

    const wrapIdsAt = (organizationId: string, vaultVersion: number) =>
      run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          const wraps = yield* repo.listWraps({ organizationId, vaultVersion });
          return wraps.map((wrap) => wrap.userEncryptionKeyId).sort();
        }),
      );

    const credentialRow = (id: string) =>
      env.DB.prepare(
        `SELECT "wrapped_dek", "vault_version" FROM "android_upload_keystores" WHERE "id" = ?`,
      )
        .bind(id)
        .first<{ wrapped_dek: string; vault_version: number }>();

    const envVarRevisionRow = (id: string) =>
      env.DB.prepare(
        `SELECT "wrapped_dek", "vault_version" FROM "env_var_revisions" WHERE "id" = ?`,
      )
        .bind(id)
        .first<{ wrapped_dek: string; vault_version: number }>();

    beforeAll(async () => {
      await insertOrg("ov-rot", "ov-rot");
      await insertOrgKey("ov-rot-r", "ov-rot", "recovery");
      await insertOrgKey("ov-rot-m", "ov-rot", "machine");
      await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          yield* repo.bootstrap({
            organizationId: "ov-rot",
            wraps: [
              { userEncryptionKeyId: "ov-rot-r", wrappedKey: "rot-recovery-v1" },
              { userEncryptionKeyId: "ov-rot-m", wrappedKey: "rot-machine-v1" },
            ],
            now: "2026-03-01T00:00:00Z",
          });
        }),
      );
      // One encrypted credential at v1 — org-scoped, so no apple_teams FK to seed.
      await env.DB.prepare(
        `INSERT INTO "android_upload_keystores" ("id", "organization_id", "key_alias", "r2_key", "wrapped_dek", "vault_version", "created_at", "updated_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "ks-rot",
          "ov-rot",
          "alias",
          "android-upload-keystores/ov-rot/ks-rot.jks.enc",
          "ks-dek-v1",
          1,
          "2026-03-01T00:00:00Z",
          "2026-03-01T00:00:00Z",
        )
        .run();
      // One env var value revision at v1 — its DEK is wrapped under the vault key
      // exactly like a credential, so a rotation must re-wrap it too.
      await env.DB.prepare(
        `INSERT INTO "env_vars" ("id", "organization_id", "project_id", "scope", "environment", "key", "visibility", "current_revision_id", "created_at", "updated_at") VALUES (?, ?, NULL, 'global', 'production', 'API_URL', 'plaintext', ?, ?, ?)`,
      )
        .bind("ev-rot", "ov-rot", "evr-rot", "2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z")
        .run();
      await env.DB.prepare(
        `INSERT INTO "env_var_revisions" ("id", "env_var_id", "organization_id", "revision_number", "value_ciphertext", "wrapped_dek", "vault_version", "created_by_user_id", "created_at", "updated_at") VALUES (?, ?, ?, 1, ?, ?, 1, NULL, ?, ?)`,
      )
        .bind(
          "evr-rot",
          "ev-rot",
          "ov-rot",
          "evr-ct-v1",
          "evr-dek-v1",
          "2026-03-01T00:00:00Z",
          "2026-03-01T00:00:00Z",
        )
        .run();
    });

    it("listCredentialRefs returns the org's encrypted credentials + env var revisions", async () => {
      const refs = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.listCredentialRefs({ organizationId: "ov-rot" });
        }),
      );
      expect(refs).toContainEqual({ credentialType: "androidUploadKeystore", id: "ks-rot" });
      expect(refs).toContainEqual({ credentialType: "envVarValue", id: "evr-rot" });
    });

    it("listCredentialDeks returns wrapped DEKs for credentials + env var revisions", async () => {
      const deks = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.listCredentialDeks({ organizationId: "ov-rot" });
        }),
      );
      expect(deks).toContainEqual({
        credentialType: "androidUploadKeystore",
        credentialId: "ks-rot",
        wrappedDek: "ks-dek-v1",
        vaultVersion: 1,
      });
      expect(deks).toContainEqual({
        credentialType: "envVarValue",
        credentialId: "evr-rot",
        wrappedDek: "evr-dek-v1",
        vaultVersion: 1,
      });
    });

    it("re-keys recipients + credentials and bumps the version", async () => {
      const rotated = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.rotate({
            organizationId: "ov-rot",
            fromVersion: 1,
            recipientWraps: [
              { userEncryptionKeyId: "ov-rot-r", wrappedKey: "rot-recovery-v2" },
              { userEncryptionKeyId: "ov-rot-m", wrappedKey: "rot-machine-v2" },
            ],
            credentialDeks: [
              {
                credentialType: "androidUploadKeystore",
                credentialId: "ks-rot",
                wrappedDek: "ks-dek-v2",
              },
              {
                credentialType: "envVarValue",
                credentialId: "evr-rot",
                wrappedDek: "evr-dek-v2",
              },
            ],
            now: "2026-03-02T00:00:00Z",
          });
        }),
      );
      expect(rotated.vaultVersion).toBe(2);
      expect(await getVersion("ov-rot")).toBe(2);

      // Wraps moved to v2; the old v1 wraps are gone.
      expect(await wrapIdsAt("ov-rot", 2)).toEqual(["ov-rot-m", "ov-rot-r"]);
      expect(await wrapIdsAt("ov-rot", 1)).toEqual([]);

      // The credential's DEK was re-wrapped and stamped to the new version.
      const ks = await credentialRow("ks-rot");
      expect(ks?.vault_version).toBe(2);
      expect(ks?.wrapped_dek).toBe("ks-dek-v2");

      // The env var revision's DEK was re-wrapped under the new vault key too.
      const evr = await envVarRevisionRow("evr-rot");
      expect(evr?.vault_version).toBe(2);
      expect(evr?.wrapped_dek).toBe("evr-dek-v2");
    });

    it("rejects a stale fromVersion with Conflict and changes nothing", async () => {
      const result = await runEither(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.rotate({
            organizationId: "ov-rot",
            fromVersion: 1, // current is 2 now — stale
            recipientWraps: [{ userEncryptionKeyId: "ov-rot-r", wrappedKey: "rot-recovery-stale" }],
            credentialDeks: [],
            now: "2026-03-03T00:00:00Z",
          });
        }),
      );
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toMatchObject({ _tag: "Conflict" });
      }
      // The lost CAS must have left the vault and its wraps untouched at v2.
      expect(await getVersion("ov-rot")).toBe(2);
      expect(await wrapIdsAt("ov-rot", 2)).toEqual(["ov-rot-m", "ov-rot-r"]);
    });
  });

  describe("dropDeviceWrapsForUser (departure → drop + flag rotation)", () => {
    // Device keys are user-global (one key, wrapped per-org), so removal from one
    // org must be org-scoped: drop the wrap here, but only globally revoke the key
    // when it holds no wrap in ANY org.
    beforeAll(async () => {
      await insertOrg("ov-drop", "ov-drop");
      await insertOrg("ov-drop2", "ov-drop2");
      await insertOrg("ov-clear", "ov-clear");
      await insertUser("u-a");
      await insertUser("u-b");
      await insertUser("u-c");
      await insertUser("u-clr");
      await insertDeviceKey("dk-a", "u-a");
      await insertDeviceKey("dk-b", "u-b");
      await insertDeviceKey("dk-c", "u-c");
      await insertDeviceKey("dk-clr", "u-clr");
      await insertOrgKey("ov-clear-r", "ov-clear", "recovery");
      await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          // ov-drop: three device recipients; dk-a is ALSO a recipient in ov-drop2.
          yield* repo.bootstrap({
            organizationId: "ov-drop",
            wraps: [
              { userEncryptionKeyId: "dk-a", wrappedKey: "drop-a" },
              { userEncryptionKeyId: "dk-b", wrappedKey: "drop-b" },
              { userEncryptionKeyId: "dk-c", wrappedKey: "drop-c" },
            ],
            now: "2026-04-01T00:00:00Z",
          });
          yield* repo.bootstrap({
            organizationId: "ov-drop2",
            wraps: [{ userEncryptionKeyId: "dk-a", wrappedKey: "drop2-a" }],
            now: "2026-04-01T00:00:00Z",
          });
          yield* repo.bootstrap({
            organizationId: "ov-clear",
            wraps: [
              { userEncryptionKeyId: "ov-clear-r", wrappedKey: "clear-r" },
              { userEncryptionKeyId: "dk-clr", wrappedKey: "clear-dk" },
            ],
            now: "2026-04-01T00:00:00Z",
          });
        }),
      );
    });

    const drop = (organizationId: string, userId: string, now: string) =>
      run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.dropDeviceWrapsForUser({
            organizationId,
            userId,
            reason: `member-removed:${userId}`,
            now,
          });
        }),
      );

    const getVault = (organizationId: string) =>
      run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.getVault({ organizationId });
        }),
      );

    it("drops the wrap in this org + flags rotation, keeping a key wrapped elsewhere live", async () => {
      const dropped = await drop("ov-drop", "u-a", "2026-04-02T00:00:00Z");
      expect(dropped).toEqual(["dk-a"]);

      // Org-scoped: gone here, untouched in the other org.
      expect(await countWraps("ov-drop", "dk-a")).toBe(0);
      expect(await countWraps("ov-drop2", "dk-a")).toBe(1);
      // Still a recipient elsewhere → NOT globally revoked.
      expect(await keyRevokedAt("dk-a")).toBeNull();
      // A different member's wrap is untouched.
      expect(await countWraps("ov-drop", "dk-b")).toBe(1);

      const vault = await getVault("ov-drop");
      expect(vault?.rotationPending).toBe(true);
      expect(vault?.rotationPendingSince).toBe("2026-04-02T00:00:00Z");
      expect(vault?.rotationPendingReason).toBe("member-removed:u-a");
    });

    it("globally revokes a device key when this was its last org", async () => {
      const dropped = await drop("ov-drop", "u-c", "2026-04-03T00:00:00Z");
      expect(dropped).toEqual(["dk-c"]);
      expect(await countWraps("ov-drop", "dk-c")).toBe(0);
      // No wrap left in any org → revoked globally.
      expect(await keyRevokedAt("dk-c")).toBe("2026-04-03T00:00:00Z");
    });

    it("preserves the first rotation reason/since on a subsequent drop", async () => {
      const dropped = await drop("ov-drop", "u-b", "2026-04-04T00:00:00Z");
      expect(dropped).toEqual(["dk-b"]);
      const vault = await getVault("ov-drop");
      // coalesce keeps the earliest departure as the reason/since.
      expect(vault?.rotationPendingReason).toBe("member-removed:u-a");
      expect(vault?.rotationPendingSince).toBe("2026-04-02T00:00:00Z");
    });

    it("is a no-op (no flag flip) when the user holds no wrap here", async () => {
      const dropped = await drop("ov-clear", "u-a", "2026-04-05T00:00:00Z");
      expect(dropped).toEqual([]);
      const vault = await getVault("ov-clear");
      expect(vault?.rotationPending).toBe(false);
    });

    it("rotate clears the pending-rotation flag", async () => {
      await drop("ov-clear", "u-clr", "2026-04-06T00:00:00Z");
      expect((await getVault("ov-clear"))?.rotationPending).toBe(true);

      const rotated = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.rotate({
            organizationId: "ov-clear",
            fromVersion: 1,
            recipientWraps: [{ userEncryptionKeyId: "ov-clear-r", wrappedKey: "clear-r-v2" }],
            credentialDeks: [],
            now: "2026-04-07T00:00:00Z",
          });
        }),
      );
      expect(rotated.rotationPending).toBe(false);
      const vault = await getVault("ov-clear");
      expect(vault?.vaultVersion).toBe(2);
      expect(vault?.rotationPending).toBe(false);
      expect(vault?.rotationPendingSince).toBeNull();
    });
  });
});
