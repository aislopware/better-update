import { Effect } from "effect";

import type { Expression, Kysely, SqlBool } from "kysely";

import { selectUpdateRow, toUpdate, updateSortColumns } from "./update-row-mapping";

import type { DB } from "../db/schema";
import type { Platform } from "../models";
import type { UpdateSortKey, UpdateSortOrder } from "./update-row-mapping";

export interface UpdateListParams {
  readonly projectId: string;
  readonly branchId?: string;
  readonly platform?: Platform;
  readonly runtimeVersion?: string;
  readonly query?: string;
  readonly sort: UpdateSortKey;
  readonly order: UpdateSortOrder;
  readonly limit: number;
  readonly offset: number;
}

// Project-scoped paginated list extracted from updates.ts to keep that adapter
// under the file-length budget. Lives in the repositories/ layer where
// Effect.promise / D1 access is permitted.
export const queryUpdatesByProject = (db: Kysely<DB>, params: UpdateListParams) =>
  Effect.gen(function* () {
    // SECURITY: project scope is enforced by the branch subquery; the optional
    // filters are bound parameters, never interpolated. They are collected into
    // a conditions array applied once (no reassignment) so the query stays a
    // single `const`.
    const filtered = db
      .selectFrom("updates")
      .where("updates.branch_id", "in", (eb) =>
        eb
          .selectFrom("branches")
          .select("branches.id")
          .where("branches.project_id", "=", params.projectId),
      )
      .where((eb) => {
        const conditions: Expression<SqlBool>[] = [];
        if (params.branchId !== undefined) {
          conditions.push(eb("updates.branch_id", "=", params.branchId));
        }
        if (params.platform !== undefined) {
          conditions.push(eb("updates.platform", "=", params.platform));
        }
        if (params.runtimeVersion !== undefined) {
          conditions.push(eb("updates.runtime_version", "=", params.runtimeVersion));
        }
        // Case-insensitive LIKE substring match on message or git commit
        // (updates have no FTS table — LIKE is the only search path). Lives in
        // the shared `filtered` query so count and page always agree.
        if (params.query !== undefined) {
          const pattern = `%${params.query.toLowerCase()}%`;
          conditions.push(
            eb.or([
              eb(eb.fn<string>("lower", ["updates.message"]), "like", pattern),
              eb(eb.fn<string>("lower", ["updates.git_commit"]), "like", pattern),
            ]),
          );
        }
        return eb.and(conditions);
      });

    const direction = params.order === "asc" ? "asc" : "desc";

    const countRow = yield* Effect.promise(async () =>
      filtered.select((eb) => eb.fn.countAll<number>().as("count")).executeTakeFirstOrThrow(),
    );

    const rows = yield* Effect.promise(async () =>
      selectUpdateRow(filtered)
        .orderBy(updateSortColumns[params.sort], direction)
        .orderBy("updates.id", direction)
        .limit(params.limit)
        .offset(params.offset)
        .execute(),
    );

    return { items: rows.map(toUpdate), total: countRow.count };
  });
