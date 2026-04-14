import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

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
    }[];
  }) => Effect.Effect<void>;

  readonly uploadBlob: (params: {
    readonly r2Key: string;
    readonly body: ReadableStream;
    readonly contentType: string;
  }) => Effect.Effect<void>;

  readonly updateByteSize: (params: {
    readonly hash: string;
    readonly byteSize: number;
  }) => Effect.Effect<void>;

  readonly deleteBlobs: (params: { readonly r2Keys: readonly string[] }) => Effect.Effect<void>;
}

export class AssetRepo extends Context.Tag("api/AssetRepo")<AssetRepo, AssetRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

interface AssetRow {
  hash: string;
  content_type: string;
  file_ext: string;
  byte_size: number;
  r2_key: string;
  created_at: string;
}

const toAsset = (row: AssetRow) =>
  ({
    hash: row.hash,
    contentType: row.content_type,
    fileExt: row.file_ext,
    byteSize: row.byte_size,
    r2Key: row.r2_key,
    createdAt: row.created_at,
  }) satisfies AssetModel;

export const AssetRepoLive = Layer.succeed(AssetRepo, {
  findByHash: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at" FROM "assets" WHERE "hash" = ?`,
        )
          .bind(params.hash)
          .first<AssetRow>(),
      );

      return row ? toAsset(row) : null;
    }),

  findByHashes: (params) =>
    Effect.gen(function* () {
      if (params.hashes.length === 0) {
        return [];
      }

      const env = yield* cloudflareEnv;
      const placeholders = params.hashes.map(() => "?").join(", ");

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at" FROM "assets" WHERE "hash" IN (${placeholders})`,
        )
          .bind(...params.hashes)
          .all<AssetRow>(),
      );

      return rows.results.map(toAsset);
    }),

  insertBatch: (params) =>
    Effect.gen(function* () {
      if (params.assets.length === 0) {
        return;
      }

      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      const statements = params.assets.map((asset) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO "assets" ("hash", "content_type", "file_ext", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(asset.hash, asset.contentType, asset.fileExt, asset.byteSize, asset.r2Key, now),
      );

      yield* Effect.promise(async () => env.DB.batch(statements));
    }),

  uploadBlob: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.ASSETS_BUCKET.put(params.r2Key, params.body, {
          httpMetadata: { contentType: params.contentType },
        }),
      );
    }),

  updateByteSize: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "assets" SET "byte_size" = ? WHERE "hash" = ?`)
          .bind(params.byteSize, params.hash)
          .run(),
      );
    }),

  deleteBlobs: (params) =>
    Effect.gen(function* () {
      if (params.r2Keys.length === 0) {
        return;
      }

      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () => env.ASSETS_BUCKET.delete([...params.r2Keys]));
    }),
});
