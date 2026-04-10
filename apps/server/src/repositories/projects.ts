import { NotFound, Project } from "@better-update/api";
import { Context, Effect, Layer } from "effect";

import type { Conflict } from "@better-update/api";

import { cloudflareEnv } from "../cloudflare/context";
import { d1RunWithUniqueCheck } from "./d1-helpers";

// ── Port ──────────────────────────────────────────────────────────

export interface ProjectRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly name: string;
    readonly scopeKey: string;
    readonly createdAt: string;
  }) => Effect.Effect<void, Conflict>;

  readonly findByOrg: (params: {
    readonly organizationId: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<{ readonly items: readonly Project[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<Project, NotFound>;

  readonly findByScopeKey: (params: {
    readonly scopeKey: string;
  }) => Effect.Effect<Project, NotFound>;

  readonly findOrgIdById: (params: { readonly id: string }) => Effect.Effect<string, NotFound>;
}

export class ProjectRepo extends Context.Tag("api/ProjectRepo")<ProjectRepo, ProjectRepository>() {}

// ── D1 Adapter ────────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  organization_id: string;
  name: string;
  scope_key: string;
  created_at: string;
}

const toProject = (row: ProjectRow) =>
  new Project({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    scopeKey: row.scope_key,
    createdAt: row.created_at,
  });

export const ProjectRepoLive = Layer.succeed(ProjectRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* d1RunWithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(params.id, params.organizationId, params.name, params.scopeKey, params.createdAt)
            .run(),
        `A project with scope key "${params.scopeKey}" already exists`,
      );
    }),

  findByOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const countResult = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT COUNT(*) as count FROM "projects" WHERE "organization_id" = ?`)
          .bind(params.organizationId)
          .first<{ count: number }>(),
      );

      const total = countResult?.count ?? 0;

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "organization_id", "name", "scope_key", "created_at" FROM "projects" WHERE "organization_id" = ? ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
        )
          .bind(params.organizationId, params.limit, params.offset)
          .all<ProjectRow>(),
      );

      return { items: rows.results.map(toProject), total };
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "organization_id", "name", "scope_key", "created_at" FROM "projects" WHERE "id" = ?`,
        )
          .bind(params.id)
          .first<ProjectRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Project not found" }));
      }

      return toProject(row);
    }),

  findByScopeKey: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "organization_id", "name", "scope_key", "created_at" FROM "projects" WHERE "scope_key" = ?`,
        )
          .bind(params.scopeKey)
          .first<ProjectRow>(),
      );

      if (row === null) {
        return yield* Effect.fail(new NotFound({ message: "Project not found" }));
      }

      return toProject(row);
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
});
