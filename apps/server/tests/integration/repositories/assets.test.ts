import { env } from "cloudflare:test";
import { Effect } from "effect";

import { AssetRepo, AssetRepoLive } from "../../../src/repositories/assets";
import { runWithLayerAndEnv } from "../../helpers/runtime";

// ── Helpers ───────────────────────────────────────────────────────

const run = <Ret, Err>(effect: Effect.Effect<Ret, Err, AssetRepo>) =>
  runWithLayerAndEnv(effect, AssetRepoLive, env);

const seedAsset = (hash: string, byteSize = 1024) =>
  env.DB.prepare(
    `INSERT INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "content_checksum", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      hash,
      "application/javascript",
      ".js",
      byteSize,
      `assets/${hash}.js`,
      hash,
      "2026-01-01T00:00:00Z",
    )
    .run();

// ── Setup ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await seedAsset("hash-001");
  await seedAsset("hash-002");
});

// ── Tests ─────────────────────────────────────────────────────────

describe("AssetRepo — D1 integration (Kysely + session)", () => {
  it("findByHash returns the model for a known hash", async () => {
    const asset = await run(
      Effect.gen(function* () {
        const repo = yield* AssetRepo;
        return yield* repo.findByHash({ hash: "hash-001" });
      }),
    );

    expect(asset).toMatchObject({
      hash: "hash-001",
      contentType: "application/javascript",
      fileExt: ".js",
      byteSize: 1024,
      r2Key: "assets/hash-001.js",
    });
  });

  it("findByHash returns null for an unknown hash", async () => {
    const asset = await run(
      Effect.gen(function* () {
        const repo = yield* AssetRepo;
        return yield* repo.findByHash({ hash: "hash-unknown" });
      }),
    );

    expect(asset).toBeNull();
  });

  it("findByHashes returns all matched assets", async () => {
    const assets = await run(
      Effect.gen(function* () {
        const repo = yield* AssetRepo;
        return yield* repo.findByHashes({ hashes: ["hash-001", "hash-002"] });
      }),
    );

    expect(assets).toHaveLength(2);
    expect(assets.map((a) => a.hash).sort()).toEqual(["hash-001", "hash-002"]);
  });

  it("insertBatch inserts new assets and silently ignores duplicates", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* AssetRepo;
        yield* repo.insertBatch({
          assets: [
            {
              hash: "hash-003",
              contentType: "text/css",
              fileExt: ".css",
              byteSize: 512,
              r2Key: "assets/hash-003.css",
              contentChecksum: "hash-003",
            },
            // hash-001 already exists — ON CONFLICT DO NOTHING must leave it unchanged
            {
              hash: "hash-001",
              contentType: "application/javascript",
              fileExt: ".js",
              byteSize: 9999,
              r2Key: "assets/hash-001.js",
              contentChecksum: "hash-001",
            },
          ],
        });
      }),
    );

    const inserted = await env.DB.prepare(
      `SELECT "hash", "byte_size" FROM "assets" WHERE "hash" = ?`,
    )
      .bind("hash-003")
      .first<{ hash: string; byte_size: number }>();
    expect(inserted).toMatchObject({ hash: "hash-003", byte_size: 512 });

    const original = await env.DB.prepare(`SELECT "byte_size" FROM "assets" WHERE "hash" = ?`)
      .bind("hash-001")
      .first<{ byte_size: number }>();
    expect(original?.byte_size).toBe(1024);
  });

  it("updateByteSize updates the byte_size column", async () => {
    await run(
      Effect.gen(function* () {
        const repo = yield* AssetRepo;
        yield* repo.updateByteSize({ hash: "hash-002", byteSize: 2048 });
      }),
    );

    const row = await env.DB.prepare(`SELECT "byte_size" FROM "assets" WHERE "hash" = ?`)
      .bind("hash-002")
      .first<{ byte_size: number }>();
    expect(row?.byte_size).toBe(2048);
  });
});
