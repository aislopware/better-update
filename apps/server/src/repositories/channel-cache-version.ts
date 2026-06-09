import { Effect } from "effect";
import { sql } from "kysely";

import type { Kysely } from "kysely";

import type { DB } from "../db/schema";

/**
 * Bump `cache_version` for every channel that references a branch, either
 * directly (`branch_id`) OR as a gradual-rollout target inside
 * `branch_mapping_json`. The `json_each`/`json_extract` EXISTS predicate has no
 * query-builder form, so it uses the `sql` escape hatch with parameterized
 * interpolation. Mirrored by the inline predicate in `branches.ts`'s delete
 * guard (kept in sync).
 */
export const bumpChannelCacheVersionByBranchReference = (
  db: Kysely<DB>,
  branchId: string,
): Effect.Effect<void> =>
  Effect.promise(async () => {
    await db
      .updateTable("channels")
      .set((eb) => ({ cache_version: eb("cache_version", "+", 1) }))
      .where(
        sql<boolean>`
          "branch_id" = ${branchId}
          OR (
            "branch_mapping_json" IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM json_each("branch_mapping_json", '$.data') AS "branch_mapping_entry"
              WHERE json_extract("branch_mapping_entry"."value", '$.branchId') = ${branchId}
            )
          )
        `,
      )
      .execute();
  });
