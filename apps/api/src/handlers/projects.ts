import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { AuthContext } from "../auth/context";
import { assertPermission } from "../auth/permissions";
import { getEnv } from "../cloudflare/context";
import { Conflict } from "../domain/errors";
import { Project } from "../domain/project";

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

export const ProjectsGroupLive = HttpApiBuilder.group(ManagementApi, "projects", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "create");
        const ctx = yield* AuthContext;
        const env = getEnv();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        yield* Effect.tryPromise(async () =>
          env.DB.prepare(
            `INSERT INTO "projects" ("id", "organization_id", "name", "scope_key", "created_at") VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(id, ctx.organizationId, payload.name, payload.scopeKey, now)
            .run(),
        ).pipe(
          Effect.catchAll((error) => {
            if (String(error).includes("UNIQUE constraint failed")) {
              return Effect.fail(
                new Conflict({
                  message: `A project with scope key "${payload.scopeKey}" already exists`,
                }),
              );
            }
            return Effect.die(error);
          }),
        );

        return new Project({
          id,
          organizationId: ctx.organizationId,
          name: payload.name,
          scopeKey: payload.scopeKey,
          createdAt: now,
        });
      }),
    )
    .handle("list", ({ urlParams }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "read");
        const ctx = yield* AuthContext;
        const env = getEnv();
        const page = urlParams.page ?? 1;
        const limit = urlParams.limit ?? 20;
        const offset = (page - 1) * limit;

        const countResult = yield* Effect.promise(async () =>
          env.DB.prepare(`SELECT COUNT(*) as count FROM "projects" WHERE "organization_id" = ?`)
            .bind(ctx.organizationId)
            .first<{ count: number }>(),
        );

        const total = countResult?.count ?? 0;

        const rows = yield* Effect.promise(async () =>
          env.DB.prepare(
            `SELECT "id", "organization_id", "name", "scope_key", "created_at" FROM "projects" WHERE "organization_id" = ? ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
          )
            .bind(ctx.organizationId, limit, offset)
            .all<ProjectRow>(),
        );

        const items = rows.results.map(toProject);

        return { items, total, page, limit };
      }),
    ),
);
