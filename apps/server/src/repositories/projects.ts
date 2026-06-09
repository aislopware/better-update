import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import type { Expression, ExpressionBuilder, SqlBool } from "kysely";

import { d1Batch, kyselyDb } from "../cloudflare/db";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { DB } from "../db/schema";
import type { Conflict } from "../errors";
import type { ProjectModel } from "../models";

// ── Port ──────────────────────────────────────────────────────────

export type ProjectSortKey =
  | "lastActivityAt"
  | "name"
  | "createdAt"
  | "branchCount"
  | "channelCount"
  | "updateCount";

export type ProjectSortOrder = "asc" | "desc";

export interface ProjectRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly slug: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findByOrg: (params: {
    readonly organizationId: string;
    readonly query?: string | undefined;
    readonly sort: ProjectSortKey;
    readonly order: ProjectSortOrder;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly ProjectModel[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<ProjectModel, NotFound>;

  /**
   * All project ids. Drives the OTA reaper's per-project patch sweep prefix
   * (`patches/{projectId}/`). Small table; no pagination needed for a daily cron.
   */
  readonly listAllIds: () => Effect.Effect<readonly string[]>;

  readonly findBySlug: (params: {
    readonly organizationId: string;
    readonly slug: string;
  }) => Effect.Effect<ProjectModel, NotFound>;

  readonly findByIds: (params: {
    readonly ids: readonly string[];
  }) => Effect.Effect<ReadonlyMap<string, ProjectModel>>;

  readonly findOrgIdById: (params: { readonly id: string }) => Effect.Effect<string, NotFound>;

  readonly updateName: (params: {
    readonly id: string;
    readonly name: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: { readonly id: string }) => Effect.Effect<void>;

  readonly bumpLastActivity: (params: {
    readonly projectId: string;
    readonly at: string;
  }) => Effect.Effect<void>;

  readonly bumpLastActivityByBranch: (params: {
    readonly branchId: string;
    readonly at: string;
  }) => Effect.Effect<void>;
}

export class ProjectRepo extends Context.Tag("api/ProjectRepo")<ProjectRepo, ProjectRepository>() {}

// ── D1 Adapter ────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  created_at: string;
  last_activity_at: string;
  branch_count: number | null;
  channel_count: number | null;
  update_count: number | null;
}

const toProject = (row: ProjectRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    // Correlated COUNT subqueries are typed `number | null` by Kysely; coerce to
    // a plain number (a scalar COUNT subquery never actually returns null).
    branchCount: Number(row.branch_count),
    channelCount: Number(row.channel_count),
    updateCount: Number(row.update_count),
  }) satisfies ProjectModel;

// The list/detail projection: base columns plus a COALESCE'd activity timestamp
// and three correlated COUNT subqueries (branches / channels / updates per
// project). The aliases match the keys `toProject` reads.
const projectColumns = (eb: ExpressionBuilder<DB, "projects">) =>
  [
    "projects.id",
    "projects.organization_id",
    "projects.name",
    "projects.slug",
    "projects.created_at",
    sql<string>`coalesce(${eb.ref("projects.last_activity_at")}, ${eb.ref("projects.created_at")})`.as(
      "last_activity_at",
    ),
    eb
      .selectFrom("branches")
      .whereRef("branches.project_id", "=", "projects.id")
      .select((row) => row.fn.countAll<number>().as("count"))
      .as("branch_count"),
    eb
      .selectFrom("channels")
      .whereRef("channels.project_id", "=", "projects.id")
      .select((row) => row.fn.countAll<number>().as("count"))
      .as("channel_count"),
    eb
      .selectFrom("updates")
      .innerJoin("branches", "updates.branch_id", "branches.id")
      .whereRef("branches.project_id", "=", "projects.id")
      .select((row) => row.fn.countAll<number>().as("count"))
      .as("update_count"),
  ] as const;

// FTS5 trigram tokenizer requires 3+ char queries. Wrap in phrase quotes so
// Special chars (-, ", *, etc.) are treated as literal text rather than FTS
// Operators. Doubling embedded quotes is the standard FTS5 escape.
const escapeFtsPhrase = (value: string): string => `"${value.replaceAll('"', '""')}"`;

// Search predicate: FTS5 MATCH (via a correlated EXISTS over `projects_fts`) for
// 3+ char queries, falling back to a LIKE substring scan for shorter queries the
// trigram index can't tokenize. `null` when there is nothing to filter on.
const searchExpression = (
  eb: ExpressionBuilder<DB, "projects">,
  query: string | undefined,
): Expression<SqlBool> | null => {
  if (query === undefined || query.length === 0) {
    return null;
  }
  if (query.length >= 3) {
    return eb.exists(
      eb
        .selectFrom("projects_fts")
        .select(sql`1`.as("present"))
        .whereRef("projects_fts.project_id", "=", "projects.id")
        .where(sql<SqlBool>`"projects_fts" MATCH ${escapeFtsPhrase(query)}`),
    );
  }
  // Trigram FTS can't index 1-2 char tokens; LIKE keeps short queries usable.
  const pattern = `%${query.toLowerCase()}%`;
  return eb.or([
    eb(eb.fn<string>("lower", ["projects.name"]), "like", pattern),
    eb(eb.fn<string>("lower", ["projects.slug"]), "like", pattern),
  ]);
};

const projectFilter =
  (organizationId: string, query: string | undefined) =>
  (eb: ExpressionBuilder<DB, "projects">): Expression<SqlBool> => {
    const orgFilter = eb("projects.organization_id", "=", organizationId);
    const search = searchExpression(eb, query);
    return search ? eb.and([search, orgFilter]) : orgFilter;
  };

// Sort whitelist → ORDER BY expression. `name` is case-insensitive; the count
// keys reference the computed output aliases. The trailing `projects.id` tie-break
// that keeps pagination stable is applied at the call site.
const sortColumns = {
  name: sql`"projects"."name" collate nocase`,
  lastActivityAt: sql`"projects"."last_activity_at"`,
  createdAt: sql`"projects"."created_at"`,
  branchCount: sql`"branch_count"`,
  channelCount: sql`"channel_count"`,
  updateCount: sql`"update_count"`,
} satisfies Record<ProjectSortKey, unknown>;

export const ProjectRepoLive = Layer.succeed(ProjectRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* d1RunWithUniqueCheck(
        async () =>
          db
            .insertInto("projects")
            .values({
              id: params.id,
              organization_id: params.organizationId,
              name: params.name,
              slug: params.slug,
              created_at: params.createdAt,
              last_activity_at: params.createdAt,
            })
            .execute(),
        `A project with slug "${params.slug}" already exists`,
      );
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const where = projectFilter(params.organizationId, params.query);

      const countRow = yield* Effect.promise(async () =>
        db
          .selectFrom("projects")
          .where(where)
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .executeTakeFirstOrThrow(),
      );
      const total = countRow.count;

      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("projects")
          .where(where)
          .select(projectColumns)
          .orderBy(sortColumns[params.sort], params.order)
          .orderBy("projects.id", params.order)
          .limit(params.limit)
          .offset(params.offset)
          .execute(),
      );

      return { items: rows.map(toProject), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("projects")
          .select(projectColumns)
          .where("projects.id", "=", params.id)
          .executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Project not found" });
      }

      return toProject(row);
    }),

  listAllIds: () =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db.selectFrom("projects").select("id").execute(),
      );
      return rows.map((row) => row.id);
    }),

  findBySlug: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("projects")
          .select(projectColumns)
          .where("projects.organization_id", "=", params.organizationId)
          .where("projects.slug", "=", params.slug)
          .executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Project not found" });
      }

      return toProject(row);
    }),

  findByIds: (params) =>
    Effect.gen(function* () {
      if (params.ids.length === 0) {
        return new Map<string, ProjectModel>();
      }

      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("projects")
          .select(projectColumns)
          .where("projects.id", "in", params.ids)
          .execute(),
      );

      return new Map(rows.map((row) => [row.id, toProject(row)] as const));
    }),

  findOrgIdById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("projects")
          .select("organization_id")
          .where("id", "=", params.id)
          .executeTakeFirst(),
      );

      if (!row) {
        return yield* new NotFound({ message: "Project not found" });
      }

      return row.organization_id;
    }),

  updateName: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db.updateTable("projects").set({ name: params.name }).where("id", "=", params.id).execute(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      // Bump cache version before deleting channels to invalidate edge caches
      yield* Effect.promise(async () =>
        db
          .updateTable("channels")
          .set((eb) => ({ cache_version: eb("cache_version", "+", 1) }))
          .where("project_id", "=", params.id)
          .execute(),
      );

      // Cascade delete in FK dependency order
      yield* d1Batch([
        db
          .deleteFrom("update_assets")
          .where(
            "update_id",
            "in",
            db
              .selectFrom("updates as u")
              .innerJoin("branches as b", "u.branch_id", "b.id")
              .where("b.project_id", "=", params.id)
              .select("u.id"),
          ),
        db
          .deleteFrom("updates")
          .where(
            "branch_id",
            "in",
            db.selectFrom("branches").where("project_id", "=", params.id).select("id"),
          ),
        db.deleteFrom("channels").where("project_id", "=", params.id),
        db.deleteFrom("branches").where("project_id", "=", params.id),
        db.deleteFrom("projects").where("id", "=", params.id),
      ]);
    }),

  // Guard with `last_activity_at < ?` so out-of-order writes (e.g. backdated
  // Republish) don't regress a more recent activity timestamp.
  bumpLastActivity: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("projects")
          .set({ last_activity_at: params.at })
          .where("id", "=", params.projectId)
          .where((eb) =>
            eb.or([eb("last_activity_at", "is", null), eb("last_activity_at", "<", params.at)]),
          )
          .execute(),
      );
    }),

  bumpLastActivityByBranch: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .updateTable("projects")
          .set({ last_activity_at: params.at })
          .where(
            "id",
            "=",
            db.selectFrom("branches").select("project_id").where("id", "=", params.branchId),
          )
          .where((eb) =>
            eb.or([eb("last_activity_at", "is", null), eb("last_activity_at", "<", params.at)]),
          )
          .execute(),
      );
    }),
});
