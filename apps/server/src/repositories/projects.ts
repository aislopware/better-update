import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { NotFound } from "../errors";
import { d1RunWithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { ProjectModel } from "../models";

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
  }) => Effect.Effect<{ readonly items: readonly ProjectModel[]; readonly total: number }>;

  readonly findById: (params: { readonly id: string }) => Effect.Effect<ProjectModel, NotFound>;

  readonly findByScopeKey: (params: {
    readonly scopeKey: string;
  }) => Effect.Effect<ProjectModel, NotFound>;

  readonly findOrgIdById: (params: { readonly id: string }) => Effect.Effect<string, NotFound>;

  readonly updateName: (params: {
    readonly id: string;
    readonly name: string;
  }) => Effect.Effect<void>;

  readonly delete: (params: {
    readonly id: string;
  }) => Effect.Effect<{ readonly patchR2Keys: readonly string[] }>;
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
  ({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    scopeKey: row.scope_key,
    createdAt: row.created_at,
  }) satisfies ProjectModel;

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

      const projectAssets = `SELECT ua."asset_hash" FROM "update_assets" ua JOIN "updates" u ON ua."update_id" = u."id" JOIN "branches" b ON u."branch_id" = b."id" WHERE b."project_id" = ?`;
      const otherProjectAssets = `SELECT ua2."asset_hash" FROM "update_assets" ua2 JOIN "updates" u2 ON ua2."update_id" = u2."id" JOIN "branches" b2 ON u2."branch_id" = b2."id" WHERE b2."project_id" != ?`;

      // Collect patch R2 keys before cascade — only patches not referenced by other projects
      const patchRows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT p."r2_key" FROM "patches" p WHERE (p."old_asset_hash" IN (${projectAssets}) AND p."old_asset_hash" NOT IN (${otherProjectAssets})) OR (p."new_asset_hash" IN (${projectAssets}) AND p."new_asset_hash" NOT IN (${otherProjectAssets}))`,
        )
          .bind(params.id, params.id, params.id, params.id)
          .all<{ r2_key: string }>(),
      );

      // Bump cache version before deleting channels to invalidate edge caches
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "channels" SET "cache_version" = "cache_version" + 1 WHERE "project_id" = ?`,
        )
          .bind(params.id)
          .run(),
      );

      // Cascade delete in FK dependency order — only delete patches not shared with other projects
      yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "patches" WHERE (("old_asset_hash" IN (${projectAssets}) AND "old_asset_hash" NOT IN (${otherProjectAssets})) OR ("new_asset_hash" IN (${projectAssets}) AND "new_asset_hash" NOT IN (${otherProjectAssets})))`,
          ).bind(params.id, params.id, params.id, params.id),
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

      return { patchR2Keys: patchRows.results.map((row) => row.r2_key) };
    }),
});
