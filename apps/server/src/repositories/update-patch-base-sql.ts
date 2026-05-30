import { Effect } from "effect";

import type { Platform } from "../models";

/** A recent (or embedded-baseline) update joined to its launch-asset hash. */
export interface PatchBaseRow {
  readonly updateId: string;
  readonly launchAssetHash: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  readonly isEmbedded: boolean;
  readonly createdAt: string;
}

export interface PatchBaseQueryRow {
  id: string;
  asset_hash: string;
  runtime_version: string;
  platform: Platform;
  is_embedded: number;
  created_at: string;
}

export const toPatchBaseRow = (row: PatchBaseQueryRow): PatchBaseRow => ({
  updateId: row.id,
  launchAssetHash: row.asset_hash,
  runtimeVersion: row.runtime_version,
  platform: row.platform,
  isEmbedded: row.is_embedded === 1,
  createdAt: row.created_at,
});

const PATCH_BASE_COLUMNS = `u."id" AS "id", ua."asset_hash" AS "asset_hash", u."runtime_version" AS "runtime_version", u."platform" AS "platform", u."is_embedded" AS "is_embedded", u."created_at" AS "created_at"`;

const RECENT_PATCH_BASES_SQL = `SELECT ${PATCH_BASE_COLUMNS} FROM "updates" u JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 JOIN "branches" b ON b."id" = u."branch_id" WHERE b."project_id" = ? AND u."branch_id" = ? AND u."runtime_version" = ? AND u."platform" = ? AND u."is_rollback" = 0 ORDER BY u."created_at" DESC, u."id" DESC LIMIT ?`;

const EMBEDDED_PATCH_BASE_SQL = `SELECT ${PATCH_BASE_COLUMNS} FROM "updates" u JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 WHERE u."branch_id" = ? AND u."runtime_version" = ? AND u."platform" = ? AND u."is_embedded" = 1 LIMIT 1`;

/**
 * Recent published (non-rollback) updates for a (project, branch, rv, platform)
 * joined to their launch-asset hash, merged with the embedded baseline (which is
 * always a valid first-launch patch base, even when outside the recent window).
 * Deduped by updateId. This is a repository-layer I/O helper colocated with the
 * patch-base SQL it owns.
 */
export interface PatchBaseQueryParams {
  readonly projectId: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  readonly limit: number;
}

export const queryPatchBases = (
  db: D1Database,
  params: PatchBaseQueryParams,
): Effect.Effect<readonly PatchBaseRow[]> =>
  Effect.gen(function* () {
    const recent = yield* Effect.promise(async () =>
      db
        .prepare(RECENT_PATCH_BASES_SQL)
        .bind(
          params.projectId,
          params.branchId,
          params.runtimeVersion,
          params.platform,
          params.limit,
        )
        .all<PatchBaseQueryRow>(),
    );

    const embedded = yield* Effect.promise(async () =>
      db
        .prepare(EMBEDDED_PATCH_BASE_SQL)
        .bind(params.branchId, params.runtimeVersion, params.platform)
        .first<PatchBaseQueryRow>(),
    );

    const allRows = embedded === null ? recent.results : [...recent.results, embedded];
    const merged = new Map(allRows.map((row) => [row.id, toPatchBaseRow(row)]));
    return [...merged.values()];
  });
