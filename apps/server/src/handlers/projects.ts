import { AuthContext, Project } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertPermission } from "../auth/permissions";
import { ProjectRepo } from "../repositories/projects";

export const ProjectsGroupLive = HttpApiBuilder.group(ManagementApi, "projects", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "create");
        const ctx = yield* AuthContext;
        const repo = yield* ProjectRepo;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        yield* repo.insert({
          id,
          organizationId: ctx.organizationId,
          name: payload.name,
          scopeKey: payload.scopeKey,
          createdAt: now,
        });

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
        const repo = yield* ProjectRepo;
        const page = urlParams.page ?? 1;
        const limit = urlParams.limit ?? 20;
        const offset = (page - 1) * limit;

        const { items, total } = yield* repo.findByOrg({
          organizationId: ctx.organizationId,
          limit,
          offset,
        });

        return { items, total, page, limit };
      }),
    ),
);
