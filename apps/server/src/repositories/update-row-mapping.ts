import type { Platform, UpdateAssetRefModel, UpdateModel } from "../models";

// Row shapes + SQL column lists + the row->model mapper for the updates table,
// extracted from updates.ts to keep that adapter under the file-length budget.
// Pure string constants + a pure mapper; no I/O.

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
  total_asset_size: number;
  created_at: string;
}

export interface UpdateAssetRow {
  asset_key: string;
  asset_hash: string;
  is_launch: number;
  content_checksum: string | null;
}

const TOTAL_ASSET_SIZE_SUBQUERY = `(SELECT COALESCE(SUM(a."byte_size"), 0) FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" WHERE ua."update_id" = "updates"."id") AS "total_asset_size"`;
const TOTAL_ASSET_SIZE_SUBQUERY_U = `(SELECT COALESCE(SUM(a."byte_size"), 0) FROM "update_assets" ua JOIN "assets" a ON ua."asset_hash" = a."hash" WHERE ua."update_id" = u."id") AS "total_asset_size"`;

export const UPDATE_INSERT_COLUMNS = `"id", "branch_id", "runtime_version", "platform", "message", "metadata_json", "extra_json", "group_id", "rollout_percentage", "is_rollback", "signature", "certificate_chain", "manifest_body", "directive_body", "fingerprint_hash", "git_commit", "git_dirty", "is_embedded", "created_at"`;
export const UPDATE_COLUMNS = `"updates"."id", "updates"."branch_id", "updates"."runtime_version", "updates"."platform", "updates"."message", "updates"."metadata_json", "updates"."extra_json", "updates"."group_id", "updates"."rollout_percentage", "updates"."is_rollback", "updates"."signature", "updates"."certificate_chain", "updates"."manifest_body", "updates"."directive_body", "updates"."fingerprint_hash", "updates"."git_commit", "updates"."git_dirty", "updates"."created_at", ${TOTAL_ASSET_SIZE_SUBQUERY}`;
export const UPDATE_COLUMNS_U = `u."id", u."branch_id", u."runtime_version", u."platform", u."message", u."metadata_json", u."extra_json", u."group_id", u."rollout_percentage", u."is_rollback", u."signature", u."certificate_chain", u."manifest_body", u."directive_body", u."fingerprint_hash", u."git_commit", u."git_dirty", u."created_at", ${TOTAL_ASSET_SIZE_SUBQUERY_U}`;

// Bound D1 statements for one update row + its update_assets, shared by insert()
// and insertBatch() so the column list + placeholders live in one place. `db` is
// passed in to keep this file I/O-free (it only builds statements, never runs
// them).
export const buildUpdateInsertStatements = (
  db: D1Database,
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
): D1PreparedStatement[] => [
  db
    .prepare(
      `INSERT INTO "updates" (${UPDATE_INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.branchId,
      row.runtimeVersion,
      row.platform,
      row.message,
      row.metadataJson,
      row.extraJson,
      row.groupId,
      row.rolloutPercentage,
      row.isRollback ? 1 : 0,
      row.signature,
      row.certificateChain,
      row.manifestBody,
      row.directiveBody,
      row.fingerprintHash,
      row.gitCommit,
      row.gitDirty ? 1 : 0,
      row.isEmbedded ? 1 : 0,
      row.createdAt,
    ),
  ...row.assets.map((asset) =>
    db
      .prepare(
        `INSERT INTO "update_assets" ("update_id", "asset_key", "asset_hash", "is_launch") VALUES (?, ?, ?, ?)`,
      )
      .bind(row.id, asset.key, asset.hash, asset.isLaunch ? 1 : 0),
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
    totalAssetSize: row.total_asset_size,
    createdAt: row.created_at,
  }) satisfies UpdateModel;
