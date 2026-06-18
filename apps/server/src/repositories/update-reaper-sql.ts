import { Effect } from "effect";
import { chunk } from "es-toolkit";

import type { Kysely } from "kysely";

import { D1_IN_PARAM_CHUNK as IN_CHUNK, d1Batch } from "../cloudflare/db";

import type { DB } from "../db/schema";
import type { Platform } from "../models";

// OTA-reaper D1 queries, colocated I/O helpers that take a `Kysely<DB>` (mirrors
// update-patch-base-sql.ts). Keeps the conservative reap SQL out of the already
// large updates.ts adapter while staying in the repositories/ layer where
// Effect.promise / D1 access is permitted. The reaper port-method signatures
// also live here (UpdateReaperQueries) so UpdateRepository can extend them.
//
// D1 PARAMETER CEILING: D1 caps a single prepared statement at 100 bound
// parameters. None of the queries below bind a caller-controlled-length list
// into a single statement — variable-length id lists (reapIds, keepIds, hashes)
// are CHUNKED at IN_CHUNK (the shared D1_IN_PARAM_CHUNK) so each statement stays
// well under the ceiling. The keep-id NOT-IN guard is applied in JS
// (application/ota-reaper.ts), never bound into SQL, so the keep set can grow
// without bound.

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

// Conservative reap-candidate query, scoped to one project. Honors the SQL half
// of the safety invariant EXACTLY: a row is returned only if it survives EVERY
// keep clause below. The served / reachable-branch / current-base keep guard
// (clauses 4+5) is applied in JS by the caller, NOT bound here — so this
// statement binds only `projectId`, `cutoff` and `limit`, never near D1's
// ceiling.
export const queryReapableUpdateBatch = (
  db: Kysely<DB>,
  params: {
    readonly projectId: string;
    readonly cutoff: string;
    readonly limit: number;
  },
): Effect.Effect<readonly ReapableUpdateRow[]> =>
  Effect.gen(function* () {
    const rows = yield* Effect.promise(async () =>
      db
        .selectFrom("updates")
        .select(["updates.id", "updates.group_id", "updates.branch_id", "updates.runtime_version"])
        .select((eb) => eb.ref("updates.platform").$castTo<Platform>().as("platform"))
        .where("updates.branch_id", "in", (eb) =>
          eb
            .selectFrom("branches")
            .select("branches.id")
            .where("branches.project_id", "=", params.projectId),
        )
        .where("updates.created_at", "<", params.cutoff)
        // (1) NEVER reap the embedded baseline (always-servable first-launch patch base).
        .where("updates.is_embedded", "=", 0)
        // (2) NEVER reap the newest servable per (branch, platform, rv): keep U only if
        // a strictly-newer sibling shields it (so the newest row is always kept).
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom("updates as newer")
              .select((newerEb) => newerEb.lit(1).as("one"))
              .whereRef("newer.branch_id", "=", "updates.branch_id")
              .whereRef("newer.platform", "=", "updates.platform")
              .whereRef("newer.runtime_version", "=", "updates.runtime_version")
              .where((newerEb) =>
                newerEb.or([
                  newerEb("newer.created_at", ">", newerEb.ref("updates.created_at")),
                  newerEb.and([
                    newerEb("newer.created_at", "=", newerEb.ref("updates.created_at")),
                    newerEb("newer.id", ">", newerEb.ref("updates.id")),
                  ]),
                ]),
              ),
          ),
        )
        // (3) Keep the newest fully-rolled-out (rollout_percentage=100) row per tuple
        // (the rollout/rollback fallback target). If U is that newest =100 row, keep it.
        .where((eb) =>
          eb.not(
            eb.and([
              eb("updates.rollout_percentage", "=", 100),
              eb.not(
                eb.exists(
                  eb
                    .selectFrom("updates as n2")
                    .select((n2Eb) => n2Eb.lit(1).as("one"))
                    .whereRef("n2.branch_id", "=", "updates.branch_id")
                    .whereRef("n2.platform", "=", "updates.platform")
                    .whereRef("n2.runtime_version", "=", "updates.runtime_version")
                    .where("n2.rollout_percentage", "=", 100)
                    .where((n2Eb) =>
                      n2Eb.or([
                        n2Eb("n2.created_at", ">", n2Eb.ref("updates.created_at")),
                        n2Eb.and([
                          n2Eb("n2.created_at", "=", n2Eb.ref("updates.created_at")),
                          n2Eb("n2.id", ">", n2Eb.ref("updates.id")),
                        ]),
                      ]),
                    ),
                ),
              ),
            ]),
          ),
        )
        .orderBy("updates.created_at", "asc")
        .orderBy("updates.id", "asc")
        .limit(params.limit)
        .execute(),
    );

    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      branchId: row.branch_id,
      runtimeVersion: row.runtime_version,
      platform: row.platform,
    }));
  });

// Run `query(chunkIds)` once per chunk of `ids` (so a single statement never
// exceeds D1's parameter ceiling) and flatten the string results, de-duplicated.
// Empty input short-circuits.
const collectChunkedIds = (
  ids: readonly string[],
  query: (chunkIds: readonly string[]) => Promise<readonly string[]>,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    if (ids.length === 0) {
      return [];
    }
    const perChunk = yield* Effect.forEach(
      chunk([...ids], IN_CHUNK),
      (chunkIds) => Effect.promise(async () => query(chunkIds)),
      { concurrency: 1 },
    );
    return [...new Set(perChunk.flat())];
  });

export const queryAssetHashesForUpdates = (
  db: Kysely<DB>,
  updateIds: readonly string[],
): Effect.Effect<readonly string[]> =>
  collectChunkedIds(updateIds, async (chunkIds) => {
    const rows = await db
      .selectFrom("update_assets")
      .select("asset_hash")
      .distinct()
      .where("update_id", "in", chunkIds)
      .execute();
    return rows.map((row) => row.asset_hash);
  });

export const queryUnreferencedAssetHashes = (
  db: Kysely<DB>,
  hashes: readonly string[],
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    if (hashes.length === 0) {
      return [];
    }
    // A candidate hash is unreferenced iff NO surviving update_assets row points
    // at it. Computed AFTER the reaped updates' update_assets rows are deleted,
    // so any referrer is a genuine survivor — orphan decision is global per run.
    const referenced = yield* collectChunkedIds(hashes, async (chunkIds) => {
      const rows = await db
        .selectFrom("update_assets")
        .select("asset_hash")
        .distinct()
        .where("asset_hash", "in", chunkIds)
        .execute();
      return rows.map((row) => row.asset_hash);
    });
    const referencedSet = new Set(referenced);
    return hashes.filter((hash) => !referencedSet.has(hash));
  });

export const queryAssetR2Keys = (
  db: Kysely<DB>,
  hashes: readonly string[],
): Effect.Effect<readonly string[]> =>
  collectChunkedIds(hashes, async (chunkIds) => {
    const rows = await db
      .selectFrom("assets")
      .select("r2_key")
      .where("hash", "in", chunkIds)
      .execute();
    return rows.map((row) => row.r2_key);
  });

export const runDeleteUpdateRows = (
  db: Kysely<DB>,
  updateIds: readonly string[],
): Effect.Effect<{ readonly updatesDeleted: number }> =>
  Effect.gen(function* () {
    if (updateIds.length === 0) {
      return { updatesDeleted: 0 };
    }
    // Chunk so each DELETE ... IN (...) stays under D1's parameter ceiling, and
    // batch each chunk's (update_assets, updates) pair atomically. The updates
    // DELETE returns its rows so the deleted count is the returned-row count.
    const perChunk = yield* Effect.forEach(
      chunk([...updateIds], IN_CHUNK),
      (chunkIds) =>
        Effect.gen(function* () {
          const [, deletedUpdates] = yield* d1Batch([
            db.deleteFrom("update_assets").where("update_id", "in", chunkIds),
            db.deleteFrom("updates").where("id", "in", chunkIds).returning("id"),
          ]);
          return deletedUpdates.length;
        }),
      { concurrency: 1 },
    );
    return { updatesDeleted: perChunk.reduce((sum, count) => sum + count, 0) };
  });

export const runDeleteAssetRows = (
  db: Kysely<DB>,
  hashes: readonly string[],
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (hashes.length === 0) {
      return;
    }
    yield* Effect.forEach(
      chunk([...hashes], IN_CHUNK),
      (chunkHashes) =>
        Effect.promise(async () =>
          db.deleteFrom("assets").where("hash", "in", chunkHashes).execute(),
        ),
      { concurrency: 1 },
    );
  });

export const runDeleteGroup = (
  db: Kysely<DB>,
  groupId: string,
): Effect.Effect<{ readonly deleted: number }> =>
  Effect.gen(function* () {
    const [, deletedUpdates] = yield* d1Batch([
      db
        .deleteFrom("update_assets")
        .where("update_id", "in", (eb) =>
          eb.selectFrom("updates").select("updates.id").where("updates.group_id", "=", groupId),
        ),
      db.deleteFrom("updates").where("group_id", "=", groupId).returning("id"),
    ]);
    return { deleted: deletedUpdates.length };
  });

export const querySurvivingUpdateIds = (
  db: Kysely<DB>,
  projectId: string,
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    const rows = yield* Effect.promise(async () =>
      db
        .selectFrom("updates")
        .innerJoin("branches", "branches.id", "updates.branch_id")
        .select("updates.id")
        .where("branches.project_id", "=", projectId)
        .execute(),
    );
    return rows.map((row) => row.id);
  });

export const queryServableUpdateIdsForBranches = (
  db: Kysely<DB>,
  branchIds: readonly string[],
): Effect.Effect<readonly string[]> =>
  collectChunkedIds(branchIds, async (chunkIds) => {
    // The newest TWO rows per (branch, platform, rv): the manifest serving layer
    // resolves over a LIMIT-2 window (latest + previous) and can serve EITHER as
    // the rollout fallback, so both rn=1 and rn=2 must be protected.
    const ranked = db
      .selectFrom("updates")
      .select("updates.id")
      .select((eb) =>
        eb.fn
          .agg<number>("row_number")
          .over((ob) =>
            ob
              .partitionBy(["updates.branch_id", "updates.platform", "updates.runtime_version"])
              .orderBy("updates.created_at", "desc")
              .orderBy("updates.id", "desc"),
          )
          .as("rn"),
      )
      .where("updates.branch_id", "in", chunkIds);
    const rows = await db
      .selectFrom(ranked.as("ranked"))
      .select("ranked.id")
      .where("ranked.rn", "<=", 2)
      .execute();
    return rows.map((row) => row.id);
  });

export const queryPatchBaseUpdateIds = (
  db: Kysely<DB>,
  params: { readonly projectId: string; readonly limit: number },
): Effect.Effect<readonly string[]> =>
  Effect.gen(function* () {
    // Recent non-rollback launch-asset updates per (branch, rv, platform) tuple,
    // ranked newest-first and capped at `limit` per tuple, UNION the embedded
    // baselines. Mirrors queryPatchBases but at project scope (all tuples).
    const ranked = db
      .selectFrom("updates")
      .innerJoin("update_assets", (join) =>
        join
          .onRef("update_assets.update_id", "=", "updates.id")
          .on("update_assets.is_launch", "=", 1),
      )
      .select("updates.id")
      .select((eb) =>
        eb.fn
          .agg<number>("row_number")
          .over((ob) =>
            ob
              .partitionBy(["updates.branch_id", "updates.runtime_version", "updates.platform"])
              .orderBy("updates.created_at", "desc")
              .orderBy("updates.id", "desc"),
          )
          .as("rn"),
      )
      .where("updates.branch_id", "in", (eb) =>
        eb
          .selectFrom("branches")
          .select("branches.id")
          .where("branches.project_id", "=", params.projectId),
      )
      .where("updates.is_rollback", "=", 0);

    const recent = db
      .selectFrom(ranked.as("ranked"))
      .select("ranked.id")
      .where("ranked.rn", "<=", params.limit);

    const embedded = db
      .selectFrom("updates")
      .select("updates.id")
      .where("updates.branch_id", "in", (eb) =>
        eb
          .selectFrom("branches")
          .select("branches.id")
          .where("branches.project_id", "=", params.projectId),
      )
      .where("updates.is_embedded", "=", 1);

    const rows = yield* Effect.promise(async () => recent.union(embedded).execute());
    return rows.map((row) => row.id);
  });
