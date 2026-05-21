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
    });

    it("listCredentialRefs returns the org's encrypted credentials", async () => {
      const refs = await run(
        Effect.gen(function* () {
          const repo = yield* OrgVaultRepo;
          return yield* repo.listCredentialRefs({ organizationId: "ov-rot" });
        }),
      );
      expect(refs).toContainEqual({ credentialType: "androidUploadKeystore", id: "ks-rot" });
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
});
