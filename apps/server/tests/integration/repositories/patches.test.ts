import { env } from "cloudflare:test";
import { Effect } from "effect";

import { PatchRepo, PatchRepoLive } from "../../../src/repositories/patches";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// -- Helpers ------------------------------------------------------------------

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, PatchRepo>) =>
  runWithLayerAndEnv(effect, PatchRepoLive, env);

const insertOrg = (id: string) =>
  env.DB.prepare(
    `INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES (?, ?, ?, ?)`,
  )
    .bind(id, "Test Org", "test-org", "2024-01-01T00:00:00Z")
    .run();

const insertProject = (id: string, orgId: string) =>
  env.DB.prepare(
    `INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, "Test Project", `@test/${id}`, "2024-01-01T00:00:00Z")
    .run();

const insertAsset = (hash: string) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(hash, "application/javascript", "js", 1024, `assets/${hash}`, "2024-01-01T00:00:00Z")
    .run();

// -- Setup --------------------------------------------------------------------

beforeAll(async () => {
  await insertOrg("org-patch-1");
  await insertProject("proj-patch-1", "org-patch-1");

  // Insert assets that patches will reference
  await insertAsset("old-hash-aaa");
  await insertAsset("new-hash-bbb");
  await insertAsset("old-hash-ccc");
  await insertAsset("new-hash-ddd");
  await insertAsset("hash-eee");
  await insertAsset("hash-fff");
  await insertAsset("expire-old");
  await insertAsset("expire-new");
  await insertAsset("batch-old-1");
  await insertAsset("batch-new-1");
  await insertAsset("batch-old-2");
  await insertAsset("batch-new-2");
});

// -- Tests --------------------------------------------------------------------

describe("PatchRepo -- D1 integration", () => {
  describe("insert + findByHashes", () => {
    it("inserts a patch row and retrieves it by hash pair", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          yield* repo.insert({
            oldHash: "old-hash-aaa",
            newHash: "new-hash-bbb",
            byteSize: 512,
            r2Key: "patches/old-hash-aaa/new-hash-bbb.patch",
          });
        }),
      );

      const result = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findByHashes({
            oldHash: "old-hash-aaa",
            newHash: "new-hash-bbb",
          });
        }),
      );

      expect(result).not.toBeNull();
      expect(result!.old_asset_hash).toBe("old-hash-aaa");
      expect(result!.new_asset_hash).toBe("new-hash-bbb");
      expect(result!.byte_size).toBe(512);
      expect(result!.r2_key).toBe("patches/old-hash-aaa/new-hash-bbb.patch");
    });
  });

  describe("findByHashes with non-existent pair", () => {
    it("returns null for non-existent hash pair", async () => {
      const result = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findByHashes({
            oldHash: "nonexistent-old",
            newHash: "nonexistent-new",
          });
        }),
      );

      expect(result).toBeNull();
    });
  });

  describe("deleteByAssetHash", () => {
    it("deletes patches where asset is either old or new hash", async () => {
      // Insert two patches referencing hash-eee
      await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          yield* repo.insert({
            oldHash: "hash-eee",
            newHash: "hash-fff",
            byteSize: 256,
            r2Key: "patches/hash-eee/hash-fff.patch",
          });
          yield* repo.insert({
            oldHash: "old-hash-ccc",
            newHash: "hash-eee",
            byteSize: 300,
            r2Key: "patches/old-hash-ccc/hash-eee.patch",
          });
        }),
      );

      const deleted = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.deleteByAssetHash({ assetHash: "hash-eee" });
        }),
      );

      expect(deleted).toHaveLength(2);

      // Verify rows are actually gone
      const find1 = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findByHashes({ oldHash: "hash-eee", newHash: "hash-fff" });
        }),
      );
      expect(find1).toBeNull();

      const find2 = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findByHashes({ oldHash: "old-hash-ccc", newHash: "hash-eee" });
        }),
      );
      expect(find2).toBeNull();
    });
  });

  describe("findExpired", () => {
    it("returns patches older than the cutoff", async () => {
      // Insert a patch with an old created_at via direct SQL
      await env.DB.prepare(
        `INSERT INTO "patches" ("old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(
          "expire-old",
          "expire-new",
          128,
          "patches/expire-old/expire-new.patch",
          "2020-01-01T00:00:00Z",
        )
        .run();

      const result = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findExpired({ cutoff: "2025-01-01T00:00:00Z", limit: 100 });
        }),
      );

      const found = result.find(
        (r) => r.old_asset_hash === "expire-old" && r.new_asset_hash === "expire-new",
      );
      expect(found).toBeDefined();
      expect(found!.r2_key).toBe("patches/expire-old/expire-new.patch");
    });
  });

  describe("deleteBatch", () => {
    it("removes specific patch rows from D1", async () => {
      await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          yield* repo.insert({
            oldHash: "batch-old-1",
            newHash: "batch-new-1",
            byteSize: 100,
            r2Key: "patches/batch-old-1/batch-new-1.patch",
          });
          yield* repo.insert({
            oldHash: "batch-old-2",
            newHash: "batch-new-2",
            byteSize: 200,
            r2Key: "patches/batch-old-2/batch-new-2.patch",
          });
        }),
      );

      await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          yield* repo.deleteBatch({
            patches: [
              { oldHash: "batch-old-1", newHash: "batch-new-1" },
              { oldHash: "batch-old-2", newHash: "batch-new-2" },
            ],
          });
        }),
      );

      const find1 = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findByHashes({ oldHash: "batch-old-1", newHash: "batch-new-1" });
        }),
      );
      expect(find1).toBeNull();

      const find2 = await run(
        Effect.gen(function* () {
          const repo = yield* PatchRepo;
          return yield* repo.findByHashes({ oldHash: "batch-old-2", newHash: "batch-new-2" });
        }),
      );
      expect(find2).toBeNull();
    });
  });
});
