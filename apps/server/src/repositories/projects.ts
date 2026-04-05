import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { Conflict } from "../domain/errors";
import { Project } from "../domain/project";

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

      yield* Effect.tryPromise({
        try: async () =>
          env.DB.prepare(
            `INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(params.id, params.organizationId, params.name, params.scopeKey, params.createdAt)
            .run(),
        catch: (error) => error,
      }).pipe(
        Effect.catchAll((error) => {
          if (String(error).includes("UNIQUE constraint failed")) {
            return Effect.fail(
              new Conflict({
                message: `A project with scope key "${params.scopeKey}" already exists`,
              }),
            );
          }
          return Effect.die(error);
        }),
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
});
