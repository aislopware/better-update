import type { Kysely, SelectQueryBuilder } from "kysely";

import type { DB } from "../db/schema";
import type { Platform, UpdateAssetRefModel, UpdateModel } from "../models";

// Row shape + the row->model mapper + the shared column selection for the
// updates table, extracted from updates.ts to keep that adapter under the
// file-length budget. Pure Kysely builders + a pure mapper; no I/O (the caller
// passes the bound `Kysely`/`SelectQueryBuilder` so this file never runs a query).

export type UpdateSortKey = "createdAt" | "runtimeVersion" | "platform" | "rolloutPercentage";

export type UpdateSortOrder = "asc" | "desc";

// Maps the public sort key to the qualified `updates` column ordered on. Lives
// here beside the row selection so the sort surface and column shape stay together.
export const updateSortColumns: Record<
  UpdateSortKey,
  | "updates.created_at"
  | "updates.runtime_version"
  | "updates.platform"
  | "updates.rollout_percentage"
> = {
  createdAt: "updates.created_at",
  runtimeVersion: "updates.runtime_version",
  platform: "updates.platform",
  rolloutPercentage: "updates.rollout_percentage",
};

export interface UpdateRow {
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
  git_commit: string | null;
  git_dirty: number;
  // A correlated scalar subselect (COALESCE(SUM(...), 0)); Kysely types every
  // scalar subquery as nullable, so this mirrors the inferred row shape.
  total_asset_size: number | null;
  created_at: string;
}

/**
 * Apply the full update-row selection to an `updates`-scoped query: the scalar
 * columns, the `platform` column narrowed to the {@link Platform} union, and the
 * computed `total_asset_size` (`COALESCE(SUM(assets.byte_size), 0)`) correlated
 * subselect — kept under the SAME `total_asset_size` alias so {@link toUpdate}
 * keeps working. The caller supplies the (already-filtered) builder and may chain
 * `orderBy`/`limit`/`offset`/`execute` on the result.
 */
export const selectUpdateRow = <Output>(qb: SelectQueryBuilder<DB, "updates", Output>) =>
  qb
    .select([
      "updates.id",
      "updates.branch_id",
      "updates.runtime_version",
      "updates.message",
      "updates.metadata_json",
      "updates.extra_json",
      "updates.group_id",
      "updates.rollout_percentage",
      "updates.is_rollback",
      "updates.signature",
      "updates.certificate_chain",
      "updates.manifest_body",
      "updates.directive_body",
      "updates.fingerprint_hash",
      "updates.git_commit",
      "updates.git_dirty",
      "updates.created_at",
    ])
    .select((eb) => eb.ref("updates.platform").$castTo<Platform>().as("platform"))
    .select((eb) =>
      eb
        .selectFrom("update_assets")
        .innerJoin("assets", "assets.hash", "update_assets.asset_hash")
        .whereRef("update_assets.update_id", "=", "updates.id")
        .select((agg) =>
          agg.fn.coalesce(agg.fn.sum<number | null>("assets.byte_size"), agg.lit(0)).as("total"),
        )
        .as("total_asset_size"),
    );

// Kysely insert builders for one update row + its update_assets, shared by
// insert() and insertBatch() so the column mapping lives in one place. `db` is
// passed in to keep this file I/O-free (it only builds statements, never runs
// them — the caller batches + executes them).
export const buildUpdateInsertStatements = (
  db: Kysely<DB>,
  row: {
    readonly id: string;
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
    readonly isEmbedded: boolean;
    readonly createdAt: string;
    readonly assets: readonly UpdateAssetRefModel[];
  },
) => [
  db.insertInto("updates").values({
    id: row.id,
    branch_id: row.branchId,
    runtime_version: row.runtimeVersion,
    platform: row.platform,
    message: row.message,
    metadata_json: row.metadataJson,
    extra_json: row.extraJson,
    group_id: row.groupId,
    rollout_percentage: row.rolloutPercentage,
    is_rollback: row.isRollback ? 1 : 0,
    signature: row.signature,
    certificate_chain: row.certificateChain,
    manifest_body: row.manifestBody,
    directive_body: row.directiveBody,
    fingerprint_hash: row.fingerprintHash,
    git_commit: row.gitCommit,
    git_dirty: row.gitDirty ? 1 : 0,
    is_embedded: row.isEmbedded ? 1 : 0,
    created_at: row.createdAt,
  }),
  ...row.assets.map((asset) =>
    db.insertInto("update_assets").values({
      update_id: row.id,
      asset_key: asset.key,
      asset_hash: asset.hash,
      is_launch: asset.isLaunch ? 1 : 0,
    }),
  ),
];

export const toUpdate = (row: UpdateRow) =>
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
    gitCommit: row.git_commit,
    gitDirty: row.git_dirty === 1,
    // SQL COALESCEs the SUM to 0, so the runtime value is always a number; the
    // `?? 0` only reconciles Kysely's defensively-nullable scalar-subquery type.
    totalAssetSize: row.total_asset_size ?? 0,
    createdAt: row.created_at,
  }) satisfies UpdateModel;
