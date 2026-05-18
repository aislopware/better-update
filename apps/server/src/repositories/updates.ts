import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { toDbNull } from "../lib/nullable";

import type { Platform, UpdateAssetRefModel, UpdateModel } from "../models";

export type UpdateSortKey = "createdAt" | "runtimeVersion" | "platform" | "rolloutPercentage";

export type UpdateSortOrder = "asc" | "desc";

// -- Port ------------------------------------------------------------------

export interface UpdateRepository {
  readonly insert: (params: {
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
    readonly assets: readonly UpdateAssetRefModel[];
  }) => Effect.Effect<UpdateModel>;

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

  readonly findLatestLaunchAssetHash: (params: {
    readonly branchId: string;
    readonly platform: Platform;
    readonly runtimeVersion: string;
  }) => Effect.Effect<string | null>;

  readonly deleteGroup: (params: {
    readonly groupId: string;
  }) => Effect.Effect<{ readonly deleted: number }>;

  readonly updateRollout: (params: {
    readonly id: string;
    readonly percentage: number;
  }) => Effect.Effect<void>;

  readonly hasActiveRollout: (params: {
    readonly branchId: string;
    readonly platform: Platform;
    readonly runtimeVersion: string;
  }) => Effect.Effect<boolean>;
}

export class UpdateRepo extends Context.Tag("api/UpdateRepo")<UpdateRepo, UpdateRepository>() {}

// -- D1 Adapter ------------------------------------------------------------

interface UpdateRow {
  id: string;
  branch_id: string;
  runtime_version: string;
  platform: Platform;
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
  fingerprint_hash: string | null;
  total_asset_size: number;
  created_at: string;
}

const TOTAL_ASSET_SIZE_SUBQUERY = `(SELECT COALESCE(SUM(a."byte_size"), 0) FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" WHERE ua."update_id" = "updates"."id") AS "total_asset_size"`;
const TOTAL_ASSET_SIZE_SUBQUERY_U = `(SELECT COALESCE(SUM(a."byte_size"), 0) FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" WHERE ua."update_id" = u."id") AS "total_asset_size"`;
const UPDATE_INSERT_COLUMNS = `"id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json", "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "fingerprint_hash", "created_at"`;
const UPDATE_COLUMNS = `"updates"."id", "updates"."branch_id", "updates"."runtime_version", "updates"."platform", "updates"."message", "updates"."metadata_json", "updates"."extra_json", "updates"."group_id", "updates"."rollout_percentage", "updates"."is_rollback", "updates"."signature", "updates"."certificate_chain", "updates"."manifest_body", "updates"."directive_body", "updates"."fingerprint_hash", "updates"."created_at", ${TOTAL_ASSET_SIZE_SUBQUERY}`;
const UPDATE_COLUMNS_U = `u."id", u."branch_id", u."runtime_version", u."platform", u."message", u."metadata_json", u."extra_json", u."group_id", u."rollout_percentage", u."is_rollback", u."signature", u."certificate_chain", u."manifest_body", u."directive_body", u."fingerprint_hash", u."created_at", ${TOTAL_ASSET_SIZE_SUBQUERY_U}`;

interface UpdateAssetRow {
  asset_key: string;
  asset_hash: string;
  is_launch: number;
  content_checksum: string | null;
}

const toUpdate = (row: UpdateRow) =>
  ({
    id: row.id,
    branchId: row.branch_id,
    runtimeVersion: row.runtime_version,
    platform: row.platform,
    message: row.message,
    metadataJson: row.metadata_json,
    extraJson: row.extra_json,
    groupId: row.group_id,
    rolloutPercentage: row.rollout_percentage,
    isRollback: row.is_rollback === 1,
    signature: row.signature,
    certificateChain: row.certificate_chain,
    manifestBody: row.manifest_body,
    directiveBody: row.directive_body,
    fingerprintHash: row.fingerprint_hash,
    totalAssetSize: row.total_asset_size,
    createdAt: row.created_at,
  }) satisfies UpdateModel;

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
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const stmts = [
        env.DB.prepare(
          `INSERT INTO "updates" (${UPDATE_INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          params.branchId,
          params.runtimeVersion,
          params.platform,
          params.message,
          params.metadataJson,
          params.extraJson,
          params.groupId,
          params.rolloutPercentage,
          params.isRollback ? 1 : 0,
          params.signature,
          params.certificateChain,
          params.manifestBody,
          params.directiveBody,
          params.fingerprintHash,
          now,
        ),
        ...params.assets.map((asset) =>
          env.DB.prepare(
            `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, ?, ?, ?)`,
          ).bind(id, asset.key, asset.hash, asset.isLaunch ? 1 : 0),
        ),
      ];

      yield* Effect.promise(async () => env.DB.batch(stmts));

      const [inserted] = yield* fetchUpdatesByIds([id]);
      if (!inserted) {
        return yield* Effect.die(new Error("Inserted update vanished mid-write"));
      }
      return inserted;
    }),

  insertBatch: (params) =>
    Effect.gen(function* () {
      if (params.updates.length === 0) {
        return [];
      }

      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      const updatesWithIds = params.updates.map((update) => ({
        id: crypto.randomUUID(),
        ...update,
      }));

      const statements = updatesWithIds.flatMap((update) => [
        env.DB.prepare(
          `INSERT INTO "updates" (${UPDATE_INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          update.id,
          params.branchId,
          update.runtimeVersion,
          update.platform,
          update.message,
          update.metadataJson,
          update.extraJson,
          params.groupId,
          update.rolloutPercentage,
          update.isRollback ? 1 : 0,
          update.signature,
          update.certificateChain,
          update.manifestBody,
          update.directiveBody,
          update.fingerprintHash,
          now,
        ),
        ...update.assets.map((asset) =>
          env.DB.prepare(
            `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, ?, ?, ?)`,
          ).bind(update.id, asset.key, asset.hash, asset.isLaunch ? 1 : 0),
        ),
      ]);

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
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ua."asset_hash" AS "asset_hash" FROM "updates" u JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 WHERE u."branch_id" = ? AND u."platform" = ? AND u."runtime_version" = ? AND u."is_rollback" = 0 ORDER BY u."created_at" DESC, u."id" DESC LIMIT 1`,
        )
          .bind(params.branchId, params.platform, params.runtimeVersion)
          .first<{ asset_hash: string }>(),
      );
      return toDbNull(row?.asset_hash);
    }),

  deleteGroup: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const results = yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "update_assets" WHERE "update_id" IN (SELECT "id" FROM "updates" WHERE "group_id" = ?)`,
          ).bind(params.groupId),
          env.DB.prepare(`DELETE FROM "updates" WHERE "group_id" = ?`).bind(params.groupId),
        ]),
      );

      const [, updatesResult] = results;
      return { deleted: updatesResult ? updatesResult.meta.changes : 0 };
    }),

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
