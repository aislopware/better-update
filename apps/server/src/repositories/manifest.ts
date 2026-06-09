import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";

import type { Platform } from "../models";

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
    readonly platform: Platform;
    readonly runtimeVersion: string;
  }) => Effect.Effect<readonly UpdateRow[]>;

  readonly resolveFullyRolledOutUpdate: (params: {
    readonly branchId: string;
    readonly platform: Platform;
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

const UPDATE_COLUMNS = [
  "id",
  "branch_id",
  "runtime_version",
  "platform",
  "message",
  "metadata_json",
  "extra_json",
  "group_id",
  "rollout_percentage",
  "is_rollback",
  "signature",
  "certificate_chain",
  "manifest_body",
  "directive_body",
  "created_at",
] as const;

export const ManifestRepoLive = Layer.succeed(ManifestRepo, {
  resolveChannel: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("channels as c")
          .innerJoin("projects as p", "p.id", "c.project_id")
          .select([
            "c.branch_id",
            "c.branch_mapping_json",
            "c.cache_version",
            "c.is_paused",
            "p.scope_key",
          ])
          .where("c.project_id", "=", params.projectId)
          .where("c.name", "=", params.channelName)
          .executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Channel not found" });
      }

      return row;
    }),

  resolveUpdates: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      return yield* Effect.promise(async () =>
        db
          .selectFrom("updates")
          .select(UPDATE_COLUMNS)
          .where("branch_id", "=", params.branchId)
          .where("platform", "=", params.platform)
          .where("runtime_version", "=", params.runtimeVersion)
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(2)
          .execute(),
      );
    }),

  resolveFullyRolledOutUpdate: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("updates")
          .select(UPDATE_COLUMNS)
          .where("branch_id", "=", params.branchId)
          .where("platform", "=", params.platform)
          .where("runtime_version", "=", params.runtimeVersion)
          .where("rollout_percentage", "=", 100)
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(1)
          .executeTakeFirst(),
      );

      return toDbNull(row);
    }),

  findUpdateAssets: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      return yield* Effect.promise(async () =>
        db
          .selectFrom("update_assets as ua")
          .innerJoin("assets as a", "a.hash", "ua.asset_hash")
          .select([
            "ua.update_id",
            "ua.asset_key",
            "ua.asset_hash",
            "ua.is_launch",
            "a.hash",
            "a.content_type",
            "a.file_ext",
            "a.byte_size",
            "a.r2_key",
            "a.content_checksum",
            "a.created_at",
          ])
          .where("ua.update_id", "=", params.updateId)
          .execute(),
      );
    }),

  findLaunchAssetForUpdate: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("update_assets as ua")
          .innerJoin("assets as a", "a.hash", "ua.asset_hash")
          .innerJoin("updates as u", "u.id", "ua.update_id")
          .select(["a.hash", "a.r2_key", "a.content_type", "u.runtime_version"])
          .where("ua.update_id", "=", params.updateId)
          .where("ua.is_launch", "=", 1)
          .limit(1)
          .executeTakeFirst(),
      );

      return toDbNull(row);
    }),
});
