import { Effect } from "effect";
import { chunk } from "es-toolkit";

import type { Platform } from "../models";

// OTA-reaper D1 queries, colocated I/O helpers that take a D1Database (mirrors
// update-patch-base-sql.ts). Keeps the conservative reap SQL out of the already
// large updates.ts adapter while staying in the repositories/ layer where
// Effect.promise / D1 access is permitted. The reaper port-method signatures
// also live here (UpdateReaperQueries) so UpdateRepository can extend them.
//
// D1 PARAMETER CEILING: D1 caps a single prepared statement at 100 bound
// parameters. None of the queries below bind a caller-controlled-length list
// into a single statement — variable-length id lists (reapIds, keepIds, hashes)
// are CHUNKED at IN_CHUNK so each statement stays well under the ceiling. The
// keep-id NOT-IN guard is applied in JS (application/ota-reaper.ts), never bound
// into SQL, so the keep set can grow without bound.

// Max ids/hashes bound into a single IN (...) statement. Stays comfortably under
// D1's 100-parameter ceiling even when a query also binds a few scalars.
const IN_CHUNK = 80;

/** Minimal shape the OTA reaper needs per reap-eligible update candidate. */
export interface ReapableUpdateRow {
  readonly id: string;
  readonly groupId: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
}

/** OTA-reaper query surface mixed into UpdateRepository. */
export interface UpdateReaperQueries {
  /**
   * A batch of `projectId`'s updates older than `cutoff` that are conservatively
   * safe to reap per the SQL keep clauses (embedded baseline, newest-per-tuple,
   * newest 100%-rollout). MUST be project-scoped: the caller's keep guard is
   * project-scoped, so a global candidate set would let project B's pass reap an
   * id that only project A's keep guard protects. The caller additionally
   * filters out `keepUpdateIds` (served / reachable-branch / current-base ids) in
   * JS — this query does NOT bind that set, so it never hits D1's parameter
   * ceiling regardless of keep-set size.
   */
  readonly findReapableUpdateBatch: (params: {
    readonly projectId: string;
    readonly cutoff: string;
    readonly limit: number;
  }) => Effect.Effect<readonly ReapableUpdateRow[]>;

  /** Asset hashes referenced (in `update_assets`) by the given update ids. */
  readonly findAssetHashesForUpdates: (params: {
    readonly updateIds: readonly string[];
  }) => Effect.Effect<readonly string[]>;

  /**
   * Of the candidate hashes, the subset with ZERO surviving `update_assets`
   * referrer (no live row points at them). Run AFTER the reaped updates'
   * `update_assets` rows are deleted, so a remaining referrer is a genuine
   * survivor — making the orphan decision global across the whole run, not just
   * one batch (no cross-batch shared-asset leak).
   */
  readonly findUnreferencedAssetHashes: (params: {
    readonly hashes: readonly string[];
  }) => Effect.Effect<readonly string[]>;

  /** R2 keys (`assets.r2_key`) for the given orphan asset hashes. */
  readonly findAssetR2KeysByHashes: (params: {
    readonly hashes: readonly string[];
  }) => Effect.Effect<readonly string[]>;

  /** One D1 batch: delete the given updates' `update_assets` + `updates` rows. */
  readonly deleteUpdateRows: (params: {
    readonly updateIds: readonly string[];
  }) => Effect.Effect<{ readonly updatesDeleted: number }>;

  /** Delete the given (already-orphaned) asset rows from `assets`. */
  readonly deleteAssetRows: (params: { readonly hashes: readonly string[] }) => Effect.Effect<void>;

  /** All surviving update ids in the project (for patch cross-ref). */
  readonly findSurvivingUpdateIdsByProject: (params: {
    readonly projectId: string;
  }) => Effect.Effect<readonly string[]>;

  /**
   * The newest TWO update ids per (branch, platform, rv) across the branches:
   * the manifest serving layer resolves over a LIMIT-2 window (latest + previous)
   * and can serve the SECOND-newest as the rollout fallback, so BOTH must be
   * protected from reaping (clause 4).
   */
  readonly findServableUpdateIdsForBranches: (params: {
    readonly branchIds: readonly string[];
  }) => Effect.Effect<readonly string[]>;

  /** Current patch-base update ids for a project (clause 5). */
  readonly findPatchBaseUpdateIdsByProject: (params: {
    readonly projectId: string;
    readonly limit: number;
  }) => Effect.Effect<readonly string[]>;
}

interface ReapableRow {
  id: string;
  group_id: string;
  branch_id: string;
  runtime_version: string;
  platform: Platform;
}

// Conservative reap-candidate query, scoped to one project. Honors the SQL half
// of the safety invariant EXACTLY: a row is returned only if it survives EVERY
// keep clause below. The served / reachable-branch / current-base keep guard
// (clauses 4+5) is applied in JS by the caller, NOT bound here — so this
// statement binds only `projectId`, `cutoff` and `limit` (three parameters,
// never near D1's ceiling).
const reapableUpdateSql = `
SELECT u."id", u."group_id", u."branch_id", u."runtime_version", u."platform"
FROM "updates" u
JOIN "branches" b ON b."id" = u."branch_id"
WHERE b."project_id" = ?
  AND u."created_at" < ?
  -- (1) NEVER reap the embedded baseline (always-servable first-launch patch base).
  AND u."is_embedded" = 0
  -- (2) NEVER reap the newest servable per (branch, platform, rv): keep U only if
  -- a strictly-newer sibling shields it (so the newest row is always kept).
  AND EXISTS (
    SELECT 1 FROM "updates" newer
    WHERE newer."branch_id" = u."branch_id"
      AND newer."platform" = u."platform"
      AND newer."runtime_version" = u."runtime_version"
      AND (newer."created_at" > u."created_at"
        OR (newer."created_at" = u."created_at" AND newer."id" > u."id"))
  )
  -- (3) Keep the newest fully-rolled-out (rollout_percentage=100) row per tuple
  -- (the rollout/rollback fallback target). If U is that newest =100 row, keep it.
  AND NOT (
    u."rollout_percentage" = 100 AND NOT EXISTS (
      SELECT 1 FROM "updates" n2
      WHERE n2."branch_id" = u."branch_id"
        AND n2."platform" = u."platform"
        AND n2."runtime_version" = u."runtime_version"
        AND n2."rollout_percentage" = 100
        AND (n2."created_at" > u."created_at"
          OR (n2."created_at" = u."created_at" AND n2."id" > u."id"))
    )
  )
ORDER BY u."created_at" ASC, u."id" ASC
LIMIT ?`;

export const queryReapableUpdateBatch = (
  db: D1Database,
  params: {
    readonly projectId: string;
    readonly cutoff: string;
    readonly limit: number;
  },
): Effect.Effect<readonly ReapableUpdateRow[]> =>
  Effect.gen(function* () {
    const rows = yield* Effect.promise(async () =>
      db
        .prepare(reapableUpdateSql)
        // Source order: projectId, cutoff (WHERE), limit (LIMIT). No id lists.
        .bind(params.projectId, params.cutoff, params.limit)
        .all<ReapableRow>(),
    );

    return rows.results.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      branchId: row.branch_id,
      runtimeVersion: row.runtime_version,
      platform: row.platform,
    }));
  });

// Run `query(placeholders, chunkIds)` once per chunk of `ids` (so a single
// statement never exceeds D1's parameter ceiling) and flatten the string
// results, de-duplicated. Empty input short-circuits.
const collectChunkedIds = (
  ids: readonly string[],
  query: (placeholders: string, chunkIds: readonly string[]) => Promise<readonly string[]>,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    if (ids.length === 0) {
      return [];
    }
    const perChunk = yield* Effect.forEach(
      chunk([...ids], IN_CHUNK),
      (chunkIds) => {
        const placeholders = chunkIds.map(() => "?").join(", ");
        return Effect.promise(async () => query(placeholders, chunkIds));
      },
      { concurrency: 1 },
    );
    return [...new Set(perChunk.flat())];
  });

export const queryAssetHashesForUpdates = (
  db: D1Database,
  updateIds: readonly string[],
): Effect.Effect<readonly string[]> =>
  collectChunkedIds(updateIds, async (placeholders, chunkIds) => {
    const rows = await db
      .prepare(
        `SELECT DISTINCT "asset_hash" FROM "update_assets" WHERE "update_id" IN (${placeholders})`,
      )
      .bind(...chunkIds)
      .all<{ asset_hash: string }>();
    return rows.results.map((row) => row.asset_hash);
  });

export const queryUnreferencedAssetHashes = (
  db: D1Database,
  hashes: readonly string[],
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    if (hashes.length === 0) {
      return [];
    }
    // A candidate hash is unreferenced iff NO surviving update_assets row points
    // at it. Computed AFTER the reaped updates' update_assets rows are deleted,
    // so any referrer is a genuine survivor — orphan decision is global per run.
    const referenced = yield* collectChunkedIds(hashes, async (placeholders, chunkIds) => {
      const rows = await db
        .prepare(
          `SELECT DISTINCT "asset_hash" FROM "update_assets" WHERE "asset_hash" IN (${placeholders})`,
        )
        .bind(...chunkIds)
        .all<{ asset_hash: string }>();
      return rows.results.map((row) => row.asset_hash);
    });
    const referencedSet = new Set(referenced);
    return hashes.filter((hash) => !referencedSet.has(hash));
  });

export const queryAssetR2Keys = (
  db: D1Database,
  hashes: readonly string[],
): Effect.Effect<readonly string[]> =>
  collectChunkedIds(hashes, async (placeholders, chunkIds) => {
    const rows = await db
      .prepare(`SELECT "r2_key" FROM "assets" WHERE "hash" IN (${placeholders})`)
      .bind(...chunkIds)
      .all<{ r2_key: string }>();
    return rows.results.map((row) => row.r2_key);
  });

export const runDeleteUpdateRows = (
  db: D1Database,
  updateIds: readonly string[],
): Effect.Effect<{ readonly updatesDeleted: number }> =>
  Effect.gen(function* () {
    if (updateIds.length === 0) {
      return { updatesDeleted: 0 };
    }
    // Chunk so each DELETE ... IN (...) stays under D1's parameter ceiling, and
    // batch each chunk's (update_assets, updates) pair atomically.
    const perChunk = yield* Effect.forEach(
      chunk([...updateIds], IN_CHUNK),
      (chunkIds) =>
        Effect.gen(function* () {
          const placeholders = chunkIds.map(() => "?").join(", ");
          const results = yield* Effect.promise(async () =>
            db.batch([
              db
                .prepare(`DELETE FROM "update_assets" WHERE "update_id" IN (${placeholders})`)
                .bind(...chunkIds),
              db.prepare(`DELETE FROM "updates" WHERE "id" IN (${placeholders})`).bind(...chunkIds),
            ]),
          );
          const [, updatesResult] = results;
          return updatesResult ? updatesResult.meta.changes : 0;
        }),
      { concurrency: 1 },
    );
    return { updatesDeleted: perChunk.reduce((sum, count) => sum + count, 0) };
  });

export const runDeleteAssetRows = (
  db: D1Database,
  hashes: readonly string[],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (hashes.length === 0) {
      return;
    }
    yield* Effect.forEach(
      chunk([...hashes], IN_CHUNK),
      (chunkHashes) => {
        const placeholders = chunkHashes.map(() => "?").join(", ");
        return Effect.promise(async () =>
          db
            .prepare(`DELETE FROM "assets" WHERE "hash" IN (${placeholders})`)
            .bind(...chunkHashes)
            .run(),
        );
      },
      { concurrency: 1 },
    );
  });

export const runDeleteGroup = (
  db: D1Database,
  groupId: string,
): Effect.Effect<{ readonly deleted: number }> =>
  Effect.gen(function* () {
    const results = yield* Effect.promise(async () =>
      db.batch([
        db
          .prepare(
            `DELETE FROM "update_assets" WHERE "update_id" IN (SELECT "id" FROM "updates" WHERE "group_id" = ?)`,
          )
          .bind(groupId),
        db.prepare(`DELETE FROM "updates" WHERE "group_id" = ?`).bind(groupId),
      ]),
    );
    const [, updatesResult] = results;
    return { deleted: updatesResult ? updatesResult.meta.changes : 0 };
  });

export const querySurvivingUpdateIds = (
  db: D1Database,
  projectId: string,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const rows = yield* Effect.promise(async () =>
      db
        .prepare(
          `SELECT u."id" FROM "updates" u JOIN "branches" b ON u."branch_id" = b."id" WHERE b."project_id" = ?`,
        )
        .bind(projectId)
        .all<{ id: string }>(),
    );
    return rows.results.map((row) => row.id);
  });

export const queryServableUpdateIdsForBranches = (
  db: D1Database,
  branchIds: readonly string[],
): Effect.Effect<readonly string[]> =>
  collectChunkedIds(branchIds, async (placeholders, chunkIds) => {
    // The newest TWO rows per (branch, platform, rv): the manifest serving layer
    // resolves over a LIMIT-2 window (latest + previous) and can serve EITHER as
    // the rollout fallback, so both rn=1 and rn=2 must be protected.
    const rows = await db
      .prepare(
        `SELECT "id" FROM (SELECT u."id", ROW_NUMBER() OVER (PARTITION BY u."branch_id", u."platform", u."runtime_version" ORDER BY u."created_at" DESC, u."id" DESC) AS "rn" FROM "updates" u WHERE u."branch_id" IN (${placeholders})) WHERE "rn" <= 2`,
      )
      .bind(...chunkIds)
      .all<{ id: string }>();
    return rows.results.map((row) => row.id);
  });

export const queryPatchBaseUpdateIds = (
  db: D1Database,
  params: { readonly projectId: string; readonly limit: number },
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    // Recent non-rollback launch-asset updates per (branch, rv, platform) tuple,
    // ranked newest-first and capped at `limit` per tuple, UNION the embedded
    // baselines. Mirrors queryPatchBases but at project scope (all tuples).
    const rows = yield* Effect.promise(async () =>
      db
        .prepare(
          `SELECT "id" FROM (SELECT u."id", ROW_NUMBER() OVER (PARTITION BY u."branch_id", u."runtime_version", u."platform" ORDER BY u."created_at" DESC, u."id" DESC) AS "rn" FROM "updates" u JOIN "branches" b ON b."id" = u."branch_id" JOIN "update_assets" ua ON ua."update_id" = u."id" AND ua."is_launch" = 1 WHERE b."project_id" = ? AND u."is_rollback" = 0) WHERE "rn" <= ? UNION SELECT u."id" FROM "updates" u JOIN "branches" b ON b."id" = u."branch_id" WHERE b."project_id" = ? AND u."is_embedded" = 1`,
        )
        .bind(params.projectId, params.limit, params.projectId)
        .all<{ id: string }>(),
    );
    return rows.results.map((row) => row.id);
  });
