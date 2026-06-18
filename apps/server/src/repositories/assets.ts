import { Context, Effect, Layer } from "effect";
import { chunk } from "es-toolkit";

import { D1_IN_PARAM_CHUNK, d1Batch, kyselyDb } from "../cloudflare/db";

import type { AssetModel } from "../models";

// -- Port ------------------------------------------------------------------

export interface AssetRepository {
  readonly findByHash: (params: { readonly hash: string }) => Effect.Effect<AssetModel | null>;

  readonly findByHashes: (params: {
    readonly hashes: readonly string[];
  }) => Effect.Effect<readonly AssetModel[]>;

  readonly insertBatch: (params: {
    readonly assets: readonly {
      readonly hash: string;
      readonly contentType: string;
      readonly fileExt: string;
      readonly byteSize: number;
      readonly r2Key: string;
      readonly contentChecksum: string;
    }[];
  }) => Effect.Effect<void>;

  readonly updateByteSize: (params: {
    readonly hash: string;
    readonly byteSize: number;
  }) => Effect.Effect<void>;
}

export class AssetRepo extends Context.Tag("api/AssetRepo")<AssetRepo, AssetRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

const toAsset = (row: {
  hash: string;
  content_type: string;
  file_ext: string;
  byte_size: number;
  r2_key: string;
  content_checksum: string;
  created_at: string;
}) =>
  ({
    hash: row.hash,
    contentType: row.content_type,
    fileExt: row.file_ext,
    byteSize: row.byte_size,
    r2Key: row.r2_key,
    contentChecksum: row.content_checksum,
    createdAt: row.created_at,
  }) satisfies AssetModel;

export const AssetRepoLive = Layer.succeed(AssetRepo, {
  findByHash: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db.selectFrom("assets").selectAll().where("hash", "=", params.hash).executeTakeFirst(),
      );
      return row ? toAsset(row) : null;
    }),

  findByHashes: (params) =>
    Effect.gen(function* () {
      if (params.hashes.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;
      // Chunk the IN (...) list so a single statement never exceeds D1's
      // 100-bound-parameter ceiling (a first publish can register hundreds of
      // hashes at once).
      const chunks = yield* Effect.forEach(
        chunk([...params.hashes], D1_IN_PARAM_CHUNK),
        (hashChunk) =>
          Effect.promise(async () =>
            db.selectFrom("assets").selectAll().where("hash", "in", hashChunk).execute(),
          ),
        { concurrency: 1 },
      );
      return chunks.flat().map(toAsset);
    }),

  insertBatch: (params) =>
    Effect.gen(function* () {
      if (params.assets.length === 0) {
        return;
      }
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      // Chunk the batch so its statement count never scales unbounded with the
      // request (a first publish can register hundreds of new assets). Per-chunk
      // atomicity is sufficient: each insert is independent and idempotent
      // (`onConflict doNothing`).
      yield* Effect.forEach(
        chunk([...params.assets], D1_IN_PARAM_CHUNK),
        (assetChunk) =>
          d1Batch(
            assetChunk.map((asset) =>
              db
                .insertInto("assets")
                .values({
                  hash: asset.hash,
                  content_type: asset.contentType,
                  file_ext: asset.fileExt,
                  byte_size: asset.byteSize,
                  r2_key: asset.r2Key,
                  content_checksum: asset.contentChecksum,
                  created_at: now,
                })
                .onConflict((oc) => oc.doNothing()),
            ),
          ),
        { concurrency: 1 },
      );
    }),

  updateByteSize: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("assets")
          .set({ byte_size: params.byteSize })
          .where("hash", "=", params.hash)
          .execute(),
      );
    }),
});
