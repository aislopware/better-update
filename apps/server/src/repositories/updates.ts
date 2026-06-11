import { Context, Effect, Layer } from "effect";

import { d1Batch, kyselyDb } from "../cloudflare/db";
import { publishCreatedAt } from "../domain/signed-update-recency";
import { Conflict, NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";
import { fetchUpdatesByIds } from "./update-fetch-sql";
import { queryLatestLaunchAssetHash, queryLatestServedRow } from "./update-latest-sql";
import { queryUpdatesByProject } from "./update-list-sql";
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
import { buildUpdateInsertStatements, selectUpdateRow, toUpdate } from "./update-row-mapping";

import type { Platform, UpdateAssetRefModel, UpdateModel } from "../models";
import type { LatestServedRow, LatestTupleParams } from "./update-latest-sql";
import type { PatchBaseQueryParams, PatchBaseRow } from "./update-patch-base-sql";
import type { UpdateReaperQueries } from "./update-reaper-sql";
import type { UpdateSortKey, UpdateSortOrder } from "./update-row-mapping";

export type { UpdateSortKey, UpdateSortOrder };

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
    readonly query?: string;
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

export const UpdateRepoLive = Layer.succeed(UpdateRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = params.id ?? crypto.randomUUID();
      const createdAt = publishCreatedAt({
        manifestBody: params.manifestBody,
        directiveBody: params.directiveBody,
        fallback: new Date().toISOString(),
      });

      const statements = buildUpdateInsertStatements(db, {
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

      // The batch is atomic (d1Batch). A pinned `id` colliding with an existing
      // PRIMARY KEY is a normal, attacker-/operator-reachable input, not a defect:
      // map the D1 UNIQUE/PK rejection (a defect from the failed batch) to a typed
      // Conflict (clean 409, not 500). The collision overwrites nothing.
      yield* d1Batch(statements).pipe(
        Effect.catchAllDefect((cause) =>
          String(cause).includes("UNIQUE constraint failed")
            ? Effect.fail(new Conflict({ message: `An update with id "${id}" already exists` }))
            : Effect.die(cause),
        ),
      );

      const [inserted] = yield* fetchUpdatesByIds(db, [id]);
      if (!inserted) {
        return yield* Effect.die(new Error("Inserted update vanished mid-write"));
      }
      return inserted;
    }),

  deleteById: (params) =>
    kyselyDb.pipe(
      Effect.flatMap((db) => runDeleteUpdateRows(db, [params.id])),
      Effect.asVoid,
    ),

  clearEmbeddedBaseline: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("updates")
          .set({ is_embedded: 0 })
          .where("branch_id", "=", params.branchId)
          .where("platform", "=", params.platform)
          .where("runtime_version", "=", params.runtimeVersion)
          .where("is_embedded", "=", 1)
          .execute(),
      );
    }),

  insertBatch: (params) =>
    Effect.gen(function* () {
      if (params.updates.length === 0) {
        return [];
      }

      const db = yield* kyselyDb;
      // Signed republished rows keep their served commitTime as created_at (CLI
      // re-stamps at republish); unsigned rows fall back to a DISTINCT, increasing
      // created_at (base + i) so same-tuple rows never tie the device's selection.
      const baseMs = Date.now();
      const updatesWithIds = params.updates.map((update) => ({
        id: crypto.randomUUID(),
        ...update,
      }));

      const statements = updatesWithIds.flatMap((update, index) =>
        buildUpdateInsertStatements(db, {
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

      yield* d1Batch(statements);

      const inserted = yield* fetchUpdatesByIds(
        db,
        updatesWithIds.map((row) => row.id),
      );
      const byId = new Map(inserted.map((row) => [row.id, row]));
      return updatesWithIds.flatMap((row) => {
        const found = byId.get(row.id);
        return found ? [found] : [];
      });
    }),

  findByProject: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryUpdatesByProject(db, params))),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        selectUpdateRow(
          db.selectFrom("updates").where("updates.id", "=", params.id),
        ).executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Update not found" });
      }

      return toUpdate(row);
    }),

  findByGroupId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const rows = yield* Effect.promise(async () =>
        selectUpdateRow(
          db.selectFrom("updates").where("updates.group_id", "=", params.groupId),
        ).execute(),
      );

      return rows.map(toUpdate);
    }),

  listByProjectAndFingerprint: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const rows = yield* Effect.promise(async () =>
        selectUpdateRow(
          db
            .selectFrom("updates")
            .where("updates.branch_id", "in", (eb) =>
              eb
                .selectFrom("branches")
                .select("branches.id")
                .where("branches.project_id", "=", params.projectId),
            )
            .where("updates.fingerprint_hash", "=", params.fingerprintHash),
        )
          .orderBy("updates.created_at", "desc")
          .orderBy("updates.id", "desc")
          .execute(),
      );

      return rows.map(toUpdate);
    }),

  findAssetsByUpdateId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("update_assets")
          .innerJoin("assets", "assets.hash", "update_assets.asset_hash")
          .select([
            "update_assets.asset_key",
            "update_assets.asset_hash",
            "update_assets.is_launch",
            "assets.content_checksum",
          ])
          .where("update_assets.update_id", "=", params.updateId)
          .execute(),
      );

      return rows.map((row) => ({
        key: row.asset_key,
        hash: row.asset_hash,
        isLaunch: row.is_launch === 1,
        // assets.content_checksum is NOT NULL (TEXT NOT NULL DEFAULT '' since
        // migration 0010, backfilled to the file hash) so it is always present.
        contentChecksum: row.content_checksum,
      }));
    }),

  findLaunchAssetHashByUpdateId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("update_assets")
          .select("asset_hash")
          .where("update_id", "=", params.updateId)
          .where("is_launch", "=", 1)
          .executeTakeFirst(),
      );
      return toDbNull(row?.asset_hash);
    }),

  findLatestLaunchAssetHash: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryLatestLaunchAssetHash(db, params))),

  findLatestServedRow: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryLatestServedRow(db, params))),

  listPatchBases: (params) => kyselyDb.pipe(Effect.flatMap((db) => queryPatchBases(db, params))),

  deleteGroup: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => runDeleteGroup(db, params.groupId))),

  findReapableUpdateBatch: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryReapableUpdateBatch(db, params))),

  findAssetHashesForUpdates: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryAssetHashesForUpdates(db, params.updateIds))),

  findUnreferencedAssetHashes: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryUnreferencedAssetHashes(db, params.hashes))),

  findAssetR2KeysByHashes: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryAssetR2Keys(db, params.hashes))),

  deleteUpdateRows: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => runDeleteUpdateRows(db, params.updateIds))),

  deleteAssetRows: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => runDeleteAssetRows(db, params.hashes))),

  findSurvivingUpdateIdsByProject: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => querySurvivingUpdateIds(db, params.projectId))),

  findServableUpdateIdsForBranches: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryServableUpdateIdsForBranches(db, params.branchIds))),

  findPatchBaseUpdateIdsByProject: (params) =>
    kyselyDb.pipe(Effect.flatMap((db) => queryPatchBaseUpdateIds(db, params))),

  updateRollout: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .updateTable("updates")
          .set({ rollout_percentage: params.percentage })
          .where("id", "=", params.id)
          .execute(),
      );
    }),

  hasActiveRollout: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("updates")
          .select("rollout_percentage")
          .where("branch_id", "=", params.branchId)
          .where("platform", "=", params.platform)
          .where("runtime_version", "=", params.runtimeVersion)
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(1)
          .executeTakeFirst(),
      );

      return row !== undefined && row.rollout_percentage > 0 && row.rollout_percentage < 100;
    }),
});
