import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

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
  branch_count: number;
  channel_count: number;
  update_count: number;
}

const PROJECT_COLUMNS = `p."id", p."organization_id", p."name", p."slug", p."created_at", COALESCE(p."last_activity_at", p."created_at") AS "last_activity_at", (SELECT COUNT(*) FROM "branches" WHERE "branches"."project_id" = p."id") AS "branch_count", (SELECT COUNT(*) FROM "channels" WHERE "channels"."project_id" = p."id") AS "channel_count", (SELECT COUNT(*) FROM "updates" JOIN "branches" ON "updates"."branch_id" = "branches"."id" WHERE "branches"."project_id" = p."id") AS "update_count"`;

const toProject = (row: ProjectRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    branchCount: row.branch_count,
    channelCount: row.channel_count,
    updateCount: row.update_count,
  }) satisfies ProjectModel;

// FTS5 trigram tokenizer requires 3+ char queries. Wrap in phrase quotes so
// Special chars (-, ", *, etc.) are treated as literal text rather than FTS
// Operators. Doubling embedded quotes is the standard FTS5 escape.
const escapeFtsPhrase = (value: string): string => `"${value.replaceAll('"', '""')}"`;

interface SearchClause {
  readonly join: string;
  readonly where: string;
  readonly binds: readonly string[];
}

const buildSearchClause = (query: string | undefined): SearchClause | null => {
  if (query === undefined || query.length === 0) {
    return null;
  }
  if (query.length >= 3) {
    return {
      join: 'JOIN "projects_fts" ON "projects_fts"."project_id" = p."id"',
      where: '"projects_fts" MATCH ?',
      binds: [escapeFtsPhrase(query)],
    };
  }
  // Trigram FTS can't index 1-2 char tokens; LIKE keeps short queries usable.
  const pattern = `%${query.toLowerCase()}%`;
  return {
    join: "",
    where: '(LOWER(p."name") LIKE ? OR LOWER(p."slug") LIKE ?)',
    binds: [pattern, pattern],
  };
};

const sortColumns: Record<ProjectSortKey, string> = {
  name: 'p."name" COLLATE NOCASE',
  lastActivityAt: 'p."last_activity_at"',
  createdAt: 'p."created_at"',
  branchCount: '"branch_count"',
  channelCount: '"channel_count"',
  updateCount: '"update_count"',
};

const sortClause = (sort: ProjectSortKey, order: ProjectSortOrder): string => {
  const direction = order === "asc" ? "ASC" : "DESC";
  return `${sortColumns[sort]} ${direction}, p."id" ${direction}`;
};

export const ProjectRepoLive = Layer.succeed(ProjectRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "projects" ("id", "organization_id", "name", "slug", "created_at", "last_activity_at") VALUES (?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              params.id,
              params.organizationId,
              params.name,
              params.slug,
              params.createdAt,
              params.createdAt,
            )
            .run(),
        `A project with slug "${params.slug}" already exists`,
      );
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const search = buildSearchClause(params.query);
      const joinClause = search ? ` ${search.join}` : "";
      const whereClause = search
        ? `${search.where} AND p."organization_id" = ?`
        : 'p."organization_id" = ?';
      const filterBinds = search
        ? [...search.binds, params.organizationId]
        : [params.organizationId];

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) as count FROM "projects" p${joinClause} WHERE ${whereClause}`,
        )
          .bind(...filterBinds)
          .first<{ count: number }>(),
      );

      const total = countResult?.count ?? 0;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${PROJECT_COLUMNS} FROM "projects" p${joinClause} WHERE ${whereClause} ORDER BY ${sortClause(params.sort, params.order)} LIMIT ? OFFSET ?`,
        )
          .bind(...filterBinds, params.limit, params.offset)
          .all<ProjectRow>(),
      );

      return { items: rows.results.map(toProject), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${PROJECT_COLUMNS} FROM "projects" p WHERE p."id" = ?`)
          .bind(params.id)
          .first<ProjectRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Project not found" }));
      }

      return toProject(row);
    }),

  findBySlug: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${PROJECT_COLUMNS} FROM "projects" p WHERE p."organization_id" = ? AND p."slug" = ?`,
        )
          .bind(params.organizationId, params.slug)
          .first<ProjectRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Project not found" }));
      }

      return toProject(row);
    }),

  findByIds: (params) =>
    Effect.gen(function* () {
      if (params.ids.length === 0) {
        return new Map<string, ProjectModel>();
      }

      const env = yield* cloudflareEnv;
      const placeholders = params.ids.map(() => "?").join(", ");
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${PROJECT_COLUMNS} FROM "projects" p WHERE p."id" IN (${placeholders})`,
        )
          .bind(...params.ids)
          .all<ProjectRow>(),
      );

      return new Map(rows.results.map((row) => [row.id, toProject(row)] as const));
    }),

  findOrgIdById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "organization_id" FROM "projects" WHERE "id" = ?`)
          .bind(params.id)
          .first<{ organization_id: string }>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Project not found" }));
      }

      return row.organization_id;
    }),

  updateName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(`UPDATE "projects" SET "name" = ? WHERE "id" = ?`)
          .bind(params.name, params.id)
          .run(),
      );
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      // Bump cache version before deleting channels to invalidate edge caches
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "cache_version" = "cache_version" + 1 WHERE "project_id" = ?`,
        )
          .bind(params.id)
          .run(),
      );

      // Cascade delete in FK dependency order
      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "update_assets" WHERE "update_id" IN (SELECT u."id" FROM "updates" u JOIN "branches" b ON u."branch_id" = b."id" WHERE b."project_id" = ?)`,
          ).bind(params.id),
          env.DB.prepare(
            `DELETE FROM "updates" WHERE "branch_id" IN (SELECT "id" FROM "branches" WHERE "project_id" = ?)`,
          ).bind(params.id),
          env.DB.prepare(`DELETE FROM "channels" WHERE "project_id" = ?`).bind(params.id),
          env.DB.prepare(`DELETE FROM "branches" WHERE "project_id" = ?`).bind(params.id),
          env.DB.prepare(`DELETE FROM "projects" WHERE "id" = ?`).bind(params.id),
        ]),
      );
    }),

  // Guard with `last_activity_at < ?` so out-of-order writes (e.g. backdated
  // Republish) don't regress a more recent activity timestamp.
  bumpLastActivity: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "projects" SET "last_activity_at" = ? WHERE "id" = ? AND ("last_activity_at" IS NULL OR "last_activity_at" < ?)`,
        )
          .bind(params.at, params.projectId, params.at)
          .run(),
      );
    }),

  bumpLastActivityByBranch: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "projects" SET "last_activity_at" = ? WHERE "id" = (SELECT "project_id" FROM "branches" WHERE "id" = ?) AND ("last_activity_at" IS NULL OR "last_activity_at" < ?)`,
        )
          .bind(params.at, params.branchId, params.at)
          .run(),
      );
    }),
});
