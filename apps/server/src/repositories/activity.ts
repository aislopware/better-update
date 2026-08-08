import { Context, Effect, Layer } from "effect";
import { chunk } from "es-toolkit";

import type { Kysely, SelectQueryBuilder } from "kysely";

import { D1_IN_PARAM_CHUNK, kyselyDb } from "../cloudflare/db";

import type { DB } from "../db/schema";

// -- Port ------------------------------------------------------------------

/** One calendar day's shipping counts. Days with nothing shipped are absent. */
export interface ActivityDayModel {
  readonly date: string;
  readonly updates: number;
  readonly builds: number;
}

export interface ActivityScope {
  readonly organizationId: string;
  /** Narrow to one project; omit for the whole organization. */
  readonly projectId?: string | undefined;
  /**
   * The projects the caller may see, when that is not all of them. Omit for an
   * owner/admin — an empty array means they see none, and yields zeros.
   */
  readonly visibleProjectIds?: readonly string[] | undefined;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  readonly since: string;
}

export interface ActivityRepository {
  readonly getDailyCounts: (scope: ActivityScope) => Effect.Effect<readonly ActivityDayModel[]>;
}

export class ActivityRepo extends Context.Tag("api/ActivityRepo")<
  ActivityRepo,
  ActivityRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

interface CountRow {
  readonly day: string;
  readonly count: number;
}

/**
 * The visible-project id list, split so no single statement exceeds D1's
 * bound-parameter ceiling. `[undefined]` — one pass, unfiltered — is the
 * owner/admin case: they see the whole organization, so there is no list to
 * bind at all.
 */
const idBatches = (
  ids: readonly string[] | undefined,
): readonly (readonly string[] | undefined)[] =>
  ids === undefined ? [undefined] : chunk([...ids], D1_IN_PARAM_CHUNK);

const projectIdsQuery = (
  db: Kysely<DB>,
  scope: ActivityScope,
  visible: readonly string[] | undefined,
): SelectQueryBuilder<DB, "projects", { id: string }> => {
  const inOrg = db
    .selectFrom("projects")
    .select("id")
    .where("organization_id", "=", scope.organizationId);
  const scoped = scope.projectId === undefined ? inOrg : inOrg.where("id", "=", scope.projectId);
  return visible === undefined ? scoped : scoped.where("id", "in", visible);
};

// `created_at` is stored as an ISO string, so the calendar day is its first ten
// characters — no date functions, and the comparison against `since` stays a
// plain string range.
const dayColumn = <Table extends "updates" | "builds">(
  query: SelectQueryBuilder<DB, Table, object>,
) =>
  query.select((eb) => [
    eb.fn<string>("substr", ["created_at", eb.val(1), eb.val(10)]).as("day"),
    eb.fn.countAll<number>().as("count"),
  ]);

const asUpdates = (rows: readonly CountRow[]): readonly ActivityDayModel[] =>
  rows.map((row) => ({ date: row.day, updates: row.count, builds: 0 }));

const asBuilds = (rows: readonly CountRow[]): readonly ActivityDayModel[] =>
  rows.map((row) => ({ date: row.day, updates: 0, builds: row.count }));

/** Folds the per-batch, per-table partials into one row per day, oldest first. */
const mergeByDay = (points: readonly ActivityDayModel[]): readonly ActivityDayModel[] =>
  [
    ...points
      .reduce((byDay, point) => {
        const seen = byDay.get(point.date);
        return byDay.set(
          point.date,
          seen
            ? {
                date: point.date,
                updates: seen.updates + point.updates,
                builds: seen.builds + point.builds,
              }
            : point,
        );
      }, new Map<string, ActivityDayModel>())
      .values(),
  ].toSorted((left, right) => left.date.localeCompare(right.date));

export const ActivityRepoLive = Layer.succeed(ActivityRepo, {
  // Two GROUP BY queries per id batch, summed by day. Updates hang off branches
  // rather than projects, so they reach the project set one join further out.
  getDailyCounts: (scope) =>
    Effect.gen(function* () {
      if (scope.visibleProjectIds?.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;

      const batches = yield* Effect.forEach(idBatches(scope.visibleProjectIds), (visible) =>
        Effect.promise(async () => {
          const projectIds = projectIdsQuery(db, scope, visible);
          return Promise.all([
            dayColumn(db.selectFrom("updates"))
              .where("created_at", ">=", scope.since)
              .where(
                "branch_id",
                "in",
                db.selectFrom("branches").select("id").where("project_id", "in", projectIds),
              )
              .groupBy("day")
              .execute(),
            dayColumn(db.selectFrom("builds"))
              .where("created_at", ">=", scope.since)
              .where("project_id", "in", projectIds)
              .groupBy("day")
              .execute(),
          ]);
        }),
      );

      return mergeByDay([
        ...batches.flatMap(([updateRows]) => asUpdates(updateRows)),
        ...batches.flatMap(([, buildRows]) => asBuilds(buildRows)),
      ]);
    }),
});
