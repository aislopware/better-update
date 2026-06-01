import { Effect } from "effect";

import { toDbNull } from "../lib/nullable";

import type { Platform } from "../models";

// "Newest update for a (branch, platform, runtimeVersion) tuple" D1 queries:
// colocated I/O helpers that take a D1Database (mirrors update-reaper-sql.ts /
// update-patch-base-sql.ts) so they stay in the repositories/ layer while keeping
// them out of the already-large updates.ts adapter. Both select the latest
// non-rollback row with the same `ORDER BY created_at DESC, id DESC` the manifest
// resolution uses.

// The (branch, platform, runtimeVersion) key these queries — and several other
// UpdateRepository methods — resolve against.
export interface LatestTupleParams {
  readonly branchId: string;
  readonly platform: Platform;
  readonly runtimeVersion: string;
}

// The newest served row's precomputed bodies + DB created_at (clock-skew guard).
export interface LatestServedRow {
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly createdAt: string;
}

// Launch-asset hash of the newest non-rollback update for the tuple, or null.
export const queryLatestLaunchAssetHash = (
  db: D1Database,
  params: LatestTupleParams,
): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    const row = yield* Effect.promise(async () =>
      db
        .prepare(
          `SELECT ua."asset_hash" AS "asset_hash" FROM "updates" u JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 WHERE u."branch_id" = ? AND u."platform" = ? AND u."runtime_version" = ? AND u."is_rollback" = 0 ORDER BY u."created_at" DESC, u."id" DESC LIMIT 1`,
        )
        .bind(params.branchId, params.platform, params.runtimeVersion)
        .first<{ asset_hash: string }>(),
    );
    return toDbNull(row?.asset_hash);
  });

// The single newest row the server WILL serve for the tuple (the same
// `ORDER BY created_at DESC, id DESC LIMIT 1` the manifest resolution uses,
// including rollback directives — the latest entry wins regardless of type). Its
// manifest_body / directive_body + DB created_at feed the publish-time clock-skew
// guard, which compares an incoming precomputed publish's commitTime against this
// row's served commitTime (see domain/signed-update-recency.ts). null when the
// tuple is empty.
export const queryLatestServedRow = (
  db: D1Database,
  params: LatestTupleParams,
): Effect.Effect<LatestServedRow | null> =>
  Effect.gen(function* () {
    const row = yield* Effect.promise(async () =>
      db
        .prepare(
          `SELECT "manifest_body", "directive_body", "created_at" FROM "updates" WHERE "branch_id" = ? AND "platform" = ? AND "runtime_version" = ? ORDER BY "created_at" DESC, "id" DESC LIMIT 1`,
        )
        .bind(params.branchId, params.platform, params.runtimeVersion)
        .first<{
          manifest_body: string | null;
          directive_body: string | null;
          created_at: string;
        }>(),
    );
    return row
      ? {
          manifestBody: toDbNull(row.manifest_body),
          directiveBody: toDbNull(row.directive_body),
          createdAt: row.created_at,
        }
      : null;
  });
