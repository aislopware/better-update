import { Effect } from "effect";

import type { Kysely } from "kysely";

import { selectUpdateRow, toUpdate } from "./update-row-mapping";

import type { DB } from "../db/schema";

// Fetch updates by id and map to models — a thin fetch+map I/O helper extracted
// from updates.ts to keep that adapter under the file-length budget. Lives in the
// repositories/ layer where Effect.promise / D1 access is permitted (it composes
// the pure builders from update-row-mapping.ts, which stays I/O-free).
export const fetchUpdatesByIds = (db: Kysely<DB>, ids: readonly string[]) =>
  Effect.gen(function* () {
    if (ids.length === 0) {
      return [];
    }
    const rows = yield* Effect.promise(async () =>
      selectUpdateRow(db.selectFrom("updates").where("updates.id", "in", ids)).execute(),
    );
    return rows.map(toUpdate);
  });
