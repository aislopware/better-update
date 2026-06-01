import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { publishCreatedAt } from "../domain/signed-update-recency";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { d1WithUniqueCheck } from "./d1-helpers";
import { queryLatestLaunchAssetHash, queryLatestServedRow } from "./update-latest-sql";
import { queryPatchBases } from "./update-patch-base-sql";
import {
  queryAssetHashesForUpdates,
  queryAssetR2Keys,
  queryPatchBaseUpdateIds,
  queryReapableUpdateBatch,
  queryServableUpdateIdsForBranches,
  querySurvivingUpdateIds,
  queryUnreferencedAssetHashes,
  runDeleteAssetRows,
  runDeleteGroup,
  runDeleteUpdateRows,
} from "./update-reaper-sql";
import {
  UPDATE_COLUMNS,
  UPDATE_COLUMNS_U,
  buildUpdateInsertStatements,
  toUpdate,
} from "./update-row-mapping";

import type { Conflict } from "../errors";
import type { Platform, UpdateAssetRefModel, UpdateModel } from "../models";
import type { LatestServedRow, LatestTupleParams } from "./update-latest-sql";
import type { PatchBaseQueryParams, PatchBaseRow } from "./update-patch-base-sql";
import type { UpdateReaperQueries } from "./update-reaper-sql";
import type { UpdateAssetRow, UpdateRow } from "./update-row-mapping";

export type UpdateSortKey = "createdAt" | "runtimeVersion" | "platform" | "rolloutPercentage";

export type UpdateSortOrder = "asc" | "desc";

// -- Port ------------------------------------------------------------------

export interface UpdateRepository extends UpdateReaperQueries {
  readonly insert: (params: {
    // Optional client-chosen id (signed renders bind to it); else server UUID.
    readonly id?: string;
    readonly branchId: string;
    readonly runtimeVersion: string;
    readonly platform: Platform;
    readonly message: string;
    readonly metadataJson: string;
    readonly extraJson: string | null;
    readonly groupId: string;
    readonly rolloutPercentage: number;
    readonly isRollback: boolean;
    readonly signature: string | null;
    readonly certificateChain: string | null;
    readonly manifestBody: string | null;
    readonly directiveBody: string | null;
    readonly fingerprintHash: string | null;
    readonly gitCommit: string | null;
    readonly gitDirty: boolean;
    readonly isEmbedded?: boolean;
    readonly assets: readonly UpdateAssetRefModel[];
    // Conflict (not a defect) when a pinned `id` collides with a PK (clean 409).
  }) => Effect.Effect<UpdateModel, Conflict>;

  readonly clearEmbeddedBaseline: (params: LatestTupleParams) => Effect.Effect<void>;

  // Delete a single update row (+ its update_assets) by id. Used by the
  // embedded-baseline idempotent re-register path (publish DO single-writer
  // lock); no-op when the id is absent.
  readonly deleteById: (params: { readonly id: string }) => Effect.Effect<void>;

  readonly insertBatch: (params: {
    readonly branchId: string;
    readonly groupId: string;
    readonly updates: readonly {
      readonly runtimeVersion: string;
      readonly platform: Platform;
      readonly message: string;
      readonly metadataJson: string;
      readonly extraJson: string | null;
      readonly rolloutPercentage: number;
      readonly isRollback: boolean;
      readonly signature: string | null;
      readonly certificateChain: string | null;
      readonly manifestBody: string | null;
      readonly directiveBody: string | null;
      readonly fingerprintHash: string | null;
      readonly assets: readonly UpdateAssetRefModel[];
    }[];
  }) => Effect.Effect<readonly UpdateModel[]>;

  readonly listByProjectAndFingerprint: (params: {
    readonly projectId: string;
    readonly fingerprintHash: string;
  }) => Effect.Effect<readonly UpdateModel[]>;

  readonly findByProject: (params: {
    readonly projectId: string;
    readonly branchId?: string;
    readonly platform?: Platform;
    readonly runtimeVersion?: string;
    readonly sort: UpdateSortKey;
    readonly order: UpdateSortOrder;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly UpdateModel[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<UpdateModel, NotFound>;

  readonly findByGroupId: (params: {
    readonly groupId: string;
  }) => Effect.Effect<readonly UpdateModel[]>;

  readonly findAssetsByUpdateId: (params: {
    readonly updateId: string;
  }) => Effect.Effect<readonly UpdateAssetRefModel[]>;

  readonly findLaunchAssetHashByUpdateId: (params: {
    readonly updateId: string;
  }) => Effect.Effect<string | null>;

  readonly findLatestLaunchAssetHash: (params: LatestTupleParams) => Effect.Effect<string | null>;

  // The single newest row the server will serve for a tuple (incl. rollback
  // directives) — read by the clock-skew guard (domain/signed-update-recency.ts).
  readonly findLatestServedRow: (
    params: LatestTupleParams,
  ) => Effect.Effect<LatestServedRow | null>;

  readonly listPatchBases: (params: PatchBaseQueryParams) => Effect.Effect<readonly PatchBaseRow[]>;

  readonly deleteGroup: (params: {
    readonly groupId: string;
  }) => Effect.Effect<{ readonly deleted: number }>;

  readonly updateRollout: (params: {
    readonly id: string;
    readonly percentage: number;
  }) => Effect.Effect<void>;

  readonly hasActiveRollout: (params: LatestTupleParams) => Effect.Effect<boolean>;
}

export class UpdateRepo extends Context.Tag("api/UpdateRepo")<UpdateRepo, UpdateRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

const fetchUpdatesByIds = (ids: readonly string[]) =>
  Effect.gen(function* () {
    if (ids.length === 0) {
      return [];
    }
    const env = yield* cloudflareEnv;
    const placeholders = ids.map(() => "?").join(", ");
    const rows = yield* Effect.promise(async () =>
      env.DB.prepare(`SELECT ${UPDATE_COLUMNS} FROM "updates" WHERE "id" IN (${placeholders})`)
        .bind(...ids)
        .all<UpdateRow>(),
    );
    return rows.results.map(toUpdate);
  });

export const UpdateRepoLive = Layer.succeed(UpdateRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = params.id ?? crypto.randomUUID();
      const createdAt = publishCreatedAt({
        manifestBody: params.manifestBody,
        directiveBody: params.directiveBody,
        fallback: new Date().toISOString(),
      });

      const stmts = buildUpdateInsertStatements(env.DB, {
        id,
        branchId: params.branchId,
        runtimeVersion: params.runtimeVersion,
        platform: params.platform,
        message: params.message,
        metadataJson: params.metadataJson,
        extraJson: params.extraJson,
        groupId: params.groupId,
        rolloutPercentage: params.rolloutPercentage,
        isRollback: params.isRollback,
        signature: params.signature,
        certificateChain: params.certificateChain,
        manifestBody: params.manifestBody,
        directiveBody: params.directiveBody,
        fingerprintHash: params.fingerprintHash,
        gitCommit: params.gitCommit,
        gitDirty: params.gitDirty,
        isEmbedded: params.isEmbedded ?? false,
        createdAt,
        assets: params.assets,
      });

      // d1WithUniqueCheck (not Effect.promise): a pinned `id` colliding with an
      // existing PRIMARY KEY is a normal, attacker-/operator-reachable input,
      // not a defect. Map the D1 UNIQUE/PK rejection to a typed Conflict (clean
      // 409, not 500). The batch is atomic — a collision overwrites nothing.
      yield* d1WithUniqueCheck(
        async () => env.DB.batch(stmts),
        `An update with id "${id}" already exists`,
      );

      const [inserted] = yield* fetchUpdatesByIds([id]);
      if (!inserted) {
        return yield* Effect.die(new Error("Inserted update vanished mid-write"));
      }
      return inserted;
    }),

  deleteById: (params) =>
    cloudflareEnv.pipe(
      Effect.flatMap((env) => runDeleteUpdateRows(env.DB, [params.id])),
      Effect.asVoid,
    ),

  clearEmbeddedBaseline: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "updates" SET "is_embedded" = 0 WHERE "branch_id" = ? AND "platform" = ? AND "runtime_version" = ? AND "is_embedded" = 1`,
        )
          .bind(params.branchId, params.platform, params.runtimeVersion)
          .run(),
      );
    }),

  insertBatch: (params) =>
    Effect.gen(function* () {
      if (params.updates.length === 0) {
        return [];
      }

      const env = yield* cloudflareEnv;
      // Signed republished rows keep their served commitTime as created_at (CLI
      // re-stamps at republish); unsigned rows fall back to a DISTINCT, increasing
      // created_at (base + i) so same-tuple rows never tie the device's selection.
      const baseMs = Date.now();
      const updatesWithIds = params.updates.map((update) => ({
        id: crypto.randomUUID(),
        ...update,
      }));

      const statements = updatesWithIds.flatMap((update, index) =>
        buildUpdateInsertStatements(env.DB, {
          id: update.id,
          branchId: params.branchId,
          runtimeVersion: update.runtimeVersion,
          platform: update.platform,
          message: update.message,
          metadataJson: update.metadataJson,
          extraJson: update.extraJson,
          groupId: params.groupId,
          rolloutPercentage: update.rolloutPercentage,
          isRollback: update.isRollback,
          signature: update.signature,
          certificateChain: update.certificateChain,
          manifestBody: update.manifestBody,
          directiveBody: update.directiveBody,
          fingerprintHash: update.fingerprintHash,
          // No fresh git provenance on a republish (server-side promote).
          gitCommit: null,
          gitDirty: false,
          // Republished updates are never the embedded baseline.
          isEmbedded: false,
          createdAt: publishCreatedAt({
            manifestBody: update.manifestBody,
            directiveBody: update.directiveBody,
            fallback: new Date(baseMs + index).toISOString(),
          }),
          assets: update.assets,
        }),
      );

      yield* Effect.promise(async () => env.DB.batch(statements));

      const inserted = yield* fetchUpdatesByIds(updatesWithIds.map((row) => row.id));
      const byId = new Map(inserted.map((row) => [row.id, row]));
      return updatesWithIds.flatMap((row) => {
        const found = byId.get(row.id);
        return found ? [found] : [];
      });
    }),

  findByProject: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      // SECURITY: All condition strings are hardcoded literals. Never interpolate user input into conditions.
      const conditions: string[] = ['b."project_id" = ?'];
      const bindValues: (string | number)[] = [params.projectId];

      if (params.branchId) {
        conditions.push('u."branch_id" = ?');
        bindValues.push(params.branchId);
      }

      if (params.platform) {
        conditions.push('u."platform" = ?');
        bindValues.push(params.platform);
      }

      if (params.runtimeVersion) {
        conditions.push('u."runtime_version" = ?');
        bindValues.push(params.runtimeVersion);
      }

      const whereClause = conditions.join(" AND ");

      const sortColumns: Record<UpdateSortKey, string> = {
        createdAt: 'u."created_at"',
        runtimeVersion: 'u."runtime_version"',
        platform: 'u."platform"',
        rolloutPercentage: 'u."rollout_percentage"',
      };
      const direction = params.order === "asc" ? "ASC" : "DESC";
      const orderBy = `${sortColumns[params.sort]} ${direction}, u."id" ${direction}`;

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "updates" u JOIN "branches" b ON u."branch_id" = b."id" WHERE ${whereClause}`,
        )
          .bind(...bindValues)
          .first<{ count: number }>(),
      );
      const total = countResult?.count ?? 0;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${UPDATE_COLUMNS_U} FROM "updates" u JOIN "branches" b ON u."branch_id" = b."id" WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        )
          .bind(...bindValues, params.limit, params.offset)
          .all<UpdateRow>(),
      );

      return { items: rows.results.map(toUpdate), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${UPDATE_COLUMNS} FROM "updates" WHERE "id" = ?`)
          .bind(params.id)
          .first<UpdateRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Update not found" }));
      }

      return toUpdate(row);
    }),

  findByGroupId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${UPDATE_COLUMNS} FROM "updates" WHERE "group_id" = ?`)
          .bind(params.groupId)
          .all<UpdateRow>(),
      );

      return rows.results.map(toUpdate);
    }),

  listByProjectAndFingerprint: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${UPDATE_COLUMNS_U} FROM "updates" u JOIN "branches" b ON u."branch_id" = b."id" WHERE b."project_id" = ? AND u."fingerprint_hash" = ? ORDER BY u."created_at" DESC, u."id" DESC`,
        )
          .bind(params.projectId, params.fingerprintHash)
          .all<UpdateRow>(),
      );

      return rows.results.map(toUpdate);
    }),

  findAssetsByUpdateId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ua."asset_key", ua."asset_hash", ua."is_launch", a."content_checksum" FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" WHERE ua."update_id" = ?`,
        )
          .bind(params.updateId)
          .all<UpdateAssetRow>(),
      );

      return rows.results.map((row) =>
        row.content_checksum === null
          ? {
              key: row.asset_key,
              hash: row.asset_hash,
              isLaunch: row.is_launch === 1,
            }
          : {
              key: row.asset_key,
              hash: row.asset_hash,
              isLaunch: row.is_launch === 1,
              contentChecksum: row.content_checksum,
            },
      );
    }),

  findLaunchAssetHashByUpdateId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "asset_hash" FROM "update_assets" WHERE "update_id" = ? AND "is_launch" = 1`,
        )
          .bind(params.updateId)
          .first<{ asset_hash: string }>(),
      );
      return toDbNull(row?.asset_hash);
    }),

  findLatestLaunchAssetHash: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => queryLatestLaunchAssetHash(env.DB, params))),

  findLatestServedRow: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => queryLatestServedRow(env.DB, params))),

  listPatchBases: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => queryPatchBases(env.DB, params))),

  deleteGroup: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => runDeleteGroup(env.DB, params.groupId))),

  findReapableUpdateBatch: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => queryReapableUpdateBatch(env.DB, params))),

  findAssetHashesForUpdates: (params) =>
    cloudflareEnv.pipe(
      Effect.flatMap((env) => queryAssetHashesForUpdates(env.DB, params.updateIds)),
    ),

  findUnreferencedAssetHashes: (params) =>
    cloudflareEnv.pipe(
      Effect.flatMap((env) => queryUnreferencedAssetHashes(env.DB, params.hashes)),
    ),

  findAssetR2KeysByHashes: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => queryAssetR2Keys(env.DB, params.hashes))),

  deleteUpdateRows: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => runDeleteUpdateRows(env.DB, params.updateIds))),

  deleteAssetRows: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => runDeleteAssetRows(env.DB, params.hashes))),

  findSurvivingUpdateIdsByProject: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => querySurvivingUpdateIds(env.DB, params.projectId))),

  findServableUpdateIdsForBranches: (params) =>
    cloudflareEnv.pipe(
      Effect.flatMap((env) => queryServableUpdateIdsForBranches(env.DB, params.branchIds)),
    ),

  findPatchBaseUpdateIdsByProject: (params) =>
    cloudflareEnv.pipe(Effect.flatMap((env) => queryPatchBaseUpdateIds(env.DB, params))),

  updateRollout: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "updates" SET "rollout_percentage" = ? WHERE "id" = ?`)
          .bind(params.percentage, params.id)
          .run(),
      );
    }),

  hasActiveRollout: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "rollout_percentage" FROM "updates" WHERE "branch_id" = ? AND "platform" = ? AND "runtime_version" = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
        )
          .bind(params.branchId, params.platform, params.runtimeVersion)
          .first<{ rollout_percentage: number }>(),
      );

      return row !== null && row.rollout_percentage > 0 && row.rollout_percentage < 100;
    }),
});
