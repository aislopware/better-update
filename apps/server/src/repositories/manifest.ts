import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";

// -- Row types ---------------------------------------------------------------

export interface ChannelRow {
  branch_id: string;
  branch_mapping_json: string | null;
  cache_version: number;
  is_paused: number;
  // Joined from the owning project; NULL for legacy rows that predate the
  // scope_key backfill. The handler falls back to the PUBLIC_API_URL origin.
  scope_key: string | null;
}

export interface UpdateRow {
  id: string;
  branch_id: string;
  runtime_version: string;
  platform: string;
  message: string;
  metadata_json: string;
  extra_json: string | null;
  group_id: string;
  rollout_percentage: number;
  is_rollback: number;
  signature: string | null;
  certificate_chain: string | null;
  manifest_body: string | null;
  directive_body: string | null;
  created_at: string;
}

export interface AssetRow {
  update_id: string;
  asset_key: string;
  asset_hash: string;
  is_launch: number;
  hash: string;
  content_type: string;
  file_ext: string;
  byte_size: number;
  r2_key: string;
  content_checksum: string;
  created_at: string;
}

// -- Port --------------------------------------------------------------------

export interface ManifestRepository {
  readonly resolveChannel: (params: {
    readonly projectId: string;
    readonly channelName: string;
  }) => Effect.Effect<ChannelRow, NotFound>;

  readonly resolveUpdates: (params: {
    readonly branchId: string;
    readonly platform: string;
    readonly runtimeVersion: string;
  }) => Effect.Effect<readonly UpdateRow[]>;

  readonly resolveFullyRolledOutUpdate: (params: {
    readonly branchId: string;
    readonly platform: string;
    readonly runtimeVersion: string;
  }) => Effect.Effect<UpdateRow | null>;

  readonly findUpdateAssets: (params: {
    readonly updateId: string;
  }) => Effect.Effect<readonly AssetRow[]>;

  readonly findLaunchAssetForUpdate: (params: {
    readonly updateId: string;
  }) => Effect.Effect<LaunchAssetRow | null>;
}

export interface LaunchAssetRow {
  hash: string;
  r2_key: string;
  content_type: string;
  runtime_version: string;
}

export class ManifestRepo extends Context.Tag("api/ManifestRepo")<
  ManifestRepo,
  ManifestRepository
>() {}

// -- D1 Adapter --------------------------------------------------------------

const UPDATE_COLUMNS = `"id", "runtime_version", "platform", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "metadata_json", "extra_json", "rollout_percentage", "created_at"`;

export const ManifestRepoLive = Layer.succeed(ManifestRepo, {
  resolveChannel: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT c."branch_id", c."branch_mapping_json", c."cache_version", c."is_paused", p."scope_key" FROM "channels" c JOIN "projects" p ON c."project_id" = p."id" WHERE c."project_id" = ? AND c."name" = ?`,
        )
          .bind(params.projectId, params.channelName)
          .first<ChannelRow>(),
      );

      if (row === null) {
        return yield* new NotFound({ message: "Channel not found" });
      }

      return row;
    }),

  resolveUpdates: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${UPDATE_COLUMNS} FROM "updates" WHERE "branch_id" = ? AND "platform" = ? AND "runtime_version" = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 2`,
        )
          .bind(params.branchId, params.platform, params.runtimeVersion)
          .all<UpdateRow>(),
      );

      return rows.results;
    }),

  resolveFullyRolledOutUpdate: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${UPDATE_COLUMNS} FROM "updates" WHERE "branch_id" = ? AND "platform" = ? AND "runtime_version" = ? AND "rollout_percentage" = 100 ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
        )
          .bind(params.branchId, params.platform, params.runtimeVersion)
          .first<UpdateRow>(),
      );

      return row;
    }),

  findUpdateAssets: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ua."update_id", ua."asset_key", ua."asset_hash", ua."is_launch", a."hash", a."content_type", a."file_ext", a."byte_size", a."r2_key", a."content_checksum", a."created_at" FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" WHERE ua."update_id" = ?`,
        )
          .bind(params.updateId)
          .all<AssetRow>(),
      );

      return rows.results;
    }),

  findLaunchAssetForUpdate: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT a."hash", a."r2_key", a."content_type", u."runtime_version" FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" JOIN "updates" u ON ua."update_id" = u."id" WHERE ua."update_id" = ? AND ua."is_launch" = 1 LIMIT 1`,
        )
          .bind(params.updateId)
          .first<LaunchAssetRow>(),
      );

      return row;
    }),
});
