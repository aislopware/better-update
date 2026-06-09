import { Effect } from "effect";

import type { Kysely, SelectQueryBuilder } from "kysely";

import type { DB } from "../db/schema";
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

// The shared patch-base column projection (updates joined to its launch asset).
// `platform` is narrowed to the Platform union so the row matches
// PatchBaseQueryRow. The caller supplies the filtered `updates`+`update_assets`
// builder.
const selectPatchBaseRow = <Output>(
  qb: SelectQueryBuilder<DB, "updates" | "update_assets", Output>,
) =>
  qb
    .select([
      "updates.id",
      "update_assets.asset_hash",
      "updates.runtime_version",
      "updates.is_embedded",
      "updates.created_at",
    ])
    .select((eb) => eb.ref("updates.platform").$castTo<Platform>().as("platform"));

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
  db: Kysely<DB>,
  params: PatchBaseQueryParams,
): Effect.Effect<readonly PatchBaseRow[]> =>
  Effect.gen(function* () {
    const recent = yield* Effect.promise(async () =>
      selectPatchBaseRow(
        db
          .selectFrom("updates")
          .innerJoin("update_assets", (join) =>
            join
              .onRef("update_assets.update_id", "=", "updates.id")
              .on("update_assets.is_launch", "=", 1),
          )
          .where("updates.branch_id", "in", (eb) =>
            eb
              .selectFrom("branches")
              .select("branches.id")
              .where("branches.project_id", "=", params.projectId),
          )
          .where("updates.branch_id", "=", params.branchId)
          .where("updates.runtime_version", "=", params.runtimeVersion)
          .where("updates.platform", "=", params.platform)
          .where("updates.is_rollback", "=", 0),
      )
        .orderBy("updates.created_at", "desc")
        .orderBy("updates.id", "desc")
        .limit(params.limit)
        .execute(),
    );

    const embedded = yield* Effect.promise(async () =>
      selectPatchBaseRow(
        db
          .selectFrom("updates")
          .innerJoin("update_assets", (join) =>
            join
              .onRef("update_assets.update_id", "=", "updates.id")
              .on("update_assets.is_launch", "=", 1),
          )
          .where("updates.branch_id", "=", params.branchId)
          .where("updates.runtime_version", "=", params.runtimeVersion)
          .where("updates.platform", "=", params.platform)
          .where("updates.is_embedded", "=", 1),
      )
        .limit(1)
        .executeTakeFirst(),
    );

    const allRows = embedded === undefined ? recent : [...recent, embedded];
    const merged = new Map(allRows.map((row) => [row.id, toPatchBaseRow(row)]));
    return [...merged.values()];
  });
