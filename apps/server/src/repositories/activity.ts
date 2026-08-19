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

/** The same counts, told apart by which project they came from. */
export interface ProjectActivityDayModel extends ActivityDayModel {
  readonly projectId: string;
}

export interface ProjectActivityScope {
  readonly organizationId: string;
  /**
   * Narrow to these projects. A filter, not a grant — `visibleProjectIds` still
   * applies — so the caller passes the page it is drawing and the response stays
   * bounded on an organization with hundreds of projects.
   */
  readonly projectIds?: readonly string[] | undefined;
  /** As above: the projects the caller may see, when that is not all of them. */
  readonly visibleProjectIds?: readonly string[] | undefined;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  readonly since: string;
}

export interface ActivityRepository {
  readonly getDailyCounts: (scope: ActivityScope) => Effect.Effect<readonly ActivityDayModel[]>;
  readonly getDailyCountsByProject: (
    scope: ProjectActivityScope,
  ) => Effect.Effect<readonly ProjectActivityDayModel[]>;
}

export class ActivityRepo extends Context.Service<ActivityRepo, ActivityRepository>()(
  "api/ActivityRepo",
) {}

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

/**
 * The one id list the grouped query binds.
 *
 * Two lists reach it — what the caller asked for and what the caller may see —
 * and binding both would put two `IN` clauses in the same statement, whose
 * parameter counts add up against D1's ceiling. They mean the same thing
 * anyway: the answer is their intersection, which is a single list to chunk.
 * `undefined` is "no restriction at all", which only an owner or admin asking
 * about the whole organization reaches.
 */
const narrowIds = (
  requested: readonly string[] | undefined,
  visible: readonly string[] | undefined,
): readonly string[] | undefined => {
  if (requested === undefined) {
    return visible;
  }
  if (visible === undefined) {
    return requested;
  }
  const allowed = new Set(visible);
  return requested.filter((id) => allowed.has(id));
};

interface ProjectCountRow extends CountRow {
  readonly projectId: string;
}

const asProjectUpdates = (rows: readonly ProjectCountRow[]): readonly ProjectActivityDayModel[] =>
  rows.map((row) => ({ projectId: row.projectId, date: row.day, updates: row.count, builds: 0 }));

const asProjectBuilds = (rows: readonly ProjectCountRow[]): readonly ProjectActivityDayModel[] =>
  rows.map((row) => ({ projectId: row.projectId, date: row.day, updates: 0, builds: row.count }));

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

  // Same two GROUP BY queries, one column wider: the project comes back beside
  // the day instead of being collapsed into the organization's total. No merge
  // step — a (project, day) key appears once per table, and the two tables are
  // folded together upstream where the series is padded out.
  getDailyCountsByProject: (scope) =>
    Effect.gen(function* () {
      const ids = narrowIds(scope.projectIds, scope.visibleProjectIds);
      if (ids?.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;

      const batches = yield* Effect.forEach(idBatches(ids), (visible) =>
        Effect.promise(async () => {
          const projectIds = projectIdsQuery(db, { ...scope, projectId: undefined }, visible);
          return Promise.all([
            db
              .selectFrom("updates")
              .innerJoin("branches", "branches.id", "updates.branch_id")
              .select((eb) => [
                eb.ref("branches.project_id").as("projectId"),
                eb.fn<string>("substr", ["updates.created_at", eb.val(1), eb.val(10)]).as("day"),
                eb.fn.countAll<number>().as("count"),
              ])
              .where("updates.created_at", ">=", scope.since)
              .where("branches.project_id", "in", projectIds)
              .groupBy(["branches.project_id", "day"])
              .execute(),
            db
              .selectFrom("builds")
              .select((eb) => [
                eb.ref("builds.project_id").as("projectId"),
                eb.fn<string>("substr", ["builds.created_at", eb.val(1), eb.val(10)]).as("day"),
                eb.fn.countAll<number>().as("count"),
              ])
              .where("builds.created_at", ">=", scope.since)
              .where("builds.project_id", "in", projectIds)
              .groupBy(["builds.project_id", "day"])
              .execute(),
          ]);
        }),
      );

      return [
        ...batches.flatMap(([updateRows]) => asProjectUpdates(updateRows)),
        ...batches.flatMap(([, buildRows]) => asProjectBuilds(buildRows)),
      ];
    }),
});
