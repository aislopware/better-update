import { Effect } from "effect";

import type { Kysely } from "kysely";

import { toDbNull } from "../lib/nullable";

import type { DB } from "../db/schema";
import type { Platform } from "../models";

// "Newest update for a (branch, platform, runtimeVersion) tuple" D1 queries:
// colocated I/O helpers that take a `Kysely<DB>` (mirrors update-reaper-sql.ts /
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
  db: Kysely<DB>,
  params: LatestTupleParams,
): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    const row = yield* Effect.promise(async () =>
      db
        .selectFrom("updates")
        .innerJoin("update_assets", (join) =>
          join
            .onRef("update_assets.update_id", "=", "updates.id")
            .on("update_assets.is_launch", "=", 1),
        )
        .select("update_assets.asset_hash")
        .where("updates.branch_id", "=", params.branchId)
        .where("updates.platform", "=", params.platform)
        .where("updates.runtime_version", "=", params.runtimeVersion)
        .where("updates.is_rollback", "=", 0)
        .where("updates.is_embedded", "=", 0)
        .orderBy("updates.created_at", "desc")
        .orderBy("updates.id", "desc")
        .limit(1)
        .executeTakeFirst(),
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
  db: Kysely<DB>,
  params: LatestTupleParams,
): Effect.Effect<LatestServedRow | null> =>
  Effect.gen(function* () {
    const row = yield* Effect.promise(async () =>
      db
        .selectFrom("updates")
        .select(["manifest_body", "directive_body", "created_at"])
        .where("branch_id", "=", params.branchId)
        .where("platform", "=", params.platform)
        .where("runtime_version", "=", params.runtimeVersion)
        // Embedded baselines are never served, so they must not anchor the
        // clock-skew guard either.
        .where("is_embedded", "=", 0)
        .orderBy("created_at", "desc")
        .orderBy("id", "desc")
        .limit(1)
        .executeTakeFirst(),
    );
    return row
      ? {
          manifestBody: toDbNull(row.manifest_body),
          directiveBody: toDbNull(row.directive_body),
          createdAt: row.created_at,
        }
      : null;
  });
