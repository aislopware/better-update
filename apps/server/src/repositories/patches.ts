import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

// -- Row type ----------------------------------------------------------------

export interface PatchRow {
  old_asset_hash: string;
  new_asset_hash: string;
  byte_size: number;
  r2_key: string;
  created_at: string;
}

// -- Port --------------------------------------------------------------------

export interface PatchRepository {
  readonly findByHashes: (params: {
    readonly oldHash: string;
    readonly newHash: string;
  }) => Effect.Effect<PatchRow | null>;

  readonly insert: (params: {
    readonly oldAssetHash: string;
    readonly newAssetHash: string;
    readonly byteSize: number;
    readonly r2Key: string;
  }) => Effect.Effect<void>;

  readonly deleteByAssetHash: (params: {
    readonly assetHash: string;
  }) => Effect.Effect<readonly PatchRow[]>;

  readonly findExpired: (params: {
    readonly retentionDays: number;
    readonly limit: number;
  }) => Effect.Effect<readonly PatchRow[]>;

  readonly deleteBatch: (params: {
    readonly patches: readonly { readonly oldAssetHash: string; readonly newAssetHash: string }[];
  }) => Effect.Effect<void>;
}

export class PatchRepo extends Context.Tag("api/PatchRepo")<PatchRepo, PatchRepository>() {}

// -- D1 Adapter --------------------------------------------------------------

export const PatchRepoLive = Layer.succeed(PatchRepo, {
  findByHashes: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at" FROM "patches" WHERE "old_asset_hash" = ? AND "new_asset_hash" = ?`,
        )
          .bind(params.oldHash, params.newHash)
          .first<PatchRow>(),
      );

      return row;
    }),

  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "patches" ("old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(params.oldAssetHash, params.newAssetHash, params.byteSize, params.r2Key, now)
          .run(),
      );
    }),

  deleteByAssetHash: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at" FROM "patches" WHERE "old_asset_hash" = ? OR "new_asset_hash" = ?`,
        )
          .bind(params.assetHash, params.assetHash)
          .all<PatchRow>(),
      );

      yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "patches" WHERE "old_asset_hash" = ? OR "new_asset_hash" = ?`)
          .bind(params.assetHash, params.assetHash)
          .run(),
      );

      return rows.results;
    }),

  findExpired: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const cutoff = new Date(Date.now() - params.retentionDays * 86_400_000).toISOString();

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at" FROM "patches" WHERE "created_at" < ? LIMIT ?`,
        )
          .bind(cutoff, params.limit)
          .all<PatchRow>(),
      );

      return rows.results;
    }),

  deleteBatch: (params) =>
    Effect.gen(function* () {
      if (params.patches.length === 0) {
        return;
      }

      const env = yield* cloudflareEnv;

      const stmts = params.patches.map((patch) =>
        env.DB.prepare(
          `DELETE FROM "patches" WHERE "old_asset_hash" = ? AND "new_asset_hash" = ?`,
        ).bind(patch.oldAssetHash, patch.newAssetHash),
      );

      yield* Effect.promise(async () => env.DB.batch(stmts));
    }),
});
