import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

// -- Row types ---------------------------------------------------------------

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
    readonly oldHash: string;
    readonly newHash: string;
    readonly byteSize: number;
    readonly r2Key: string;
  }) => Effect.Effect<void>;

  readonly deleteByAssetHash: (params: {
    readonly assetHash: string;
  }) => Effect.Effect<readonly PatchRow[]>;

  readonly findExpired: (params: {
    readonly cutoff: string;
    readonly limit: number;
  }) => Effect.Effect<readonly PatchRow[]>;

  readonly deleteBatch: (params: {
    readonly patches: readonly { readonly oldHash: string; readonly newHash: string }[];
  }) => Effect.Effect<void>;
}

export class PatchRepo extends Context.Tag("api/PatchRepo")<PatchRepo, PatchRepository>() {}

// -- D1 Adapter --------------------------------------------------------------

export const PatchRepoLive = Layer.succeed(PatchRepo, {
  findByHashes: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at" FROM "patches" WHERE "old_asset_hash" = ? AND "new_asset_hash" = ?`,
        )
          .bind(params.oldHash, params.newHash)
          .first<PatchRow>(),
      );
    }),

  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "patches" ("old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(
            params.oldHash,
            params.newHash,
            params.byteSize,
            params.r2Key,
            new Date().toISOString(),
          )
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

      if (rows.results.length > 0) {
        yield* Effect.promise(async () =>
          env.DB.prepare(`DELETE FROM "patches" WHERE "old_asset_hash" = ? OR "new_asset_hash" = ?`)
            .bind(params.assetHash, params.assetHash)
            .run(),
        );
      }

      return rows.results;
    }),

  findExpired: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "old_asset_hash", "new_asset_hash", "byte_size", "r2_key", "created_at" FROM "patches" WHERE "created_at" < ? LIMIT ?`,
        )
          .bind(params.cutoff, params.limit)
          .all<PatchRow>(),
      );
      return rows.results;
    }),

  deleteBatch: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.batch(
          params.patches.map((patch) =>
            env.DB.prepare(
              `DELETE FROM "patches" WHERE "old_asset_hash" = ? AND "new_asset_hash" = ?`,
            ).bind(patch.oldHash, patch.newHash),
          ),
        ),
      );
    }),
});
