import { AuthContext, Project } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { ProjectRepo } from "../repositories/projects";

const R2_BATCH_SIZE = 1000;

const chunkArray = <T>(array: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(array.length / size) }, (_, idx) =>
    array.slice(idx * size, idx * size + size),
  );

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
    )
    .handle("get", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "read");
        const repo = yield* ProjectRepo;
        const project = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(project.organizationId);
        return project;
      }),
    )
    .handle("rename", ({ path, payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "update");
        const repo = yield* ProjectRepo;
        const project = yield* repo.findById({ id: path.id });
        yield* assertOrgOwnership(project.organizationId);
        yield* repo.updateName({ id: path.id, name: payload.name });

        return new Project({
          id: project.id,
          organizationId: project.organizationId,
          name: payload.name,
          scopeKey: project.scopeKey,
          createdAt: project.createdAt,
        });
      }),
    )
    .handle("delete", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("project", "delete");
        const projectRepo = yield* ProjectRepo;
        const project = yield* projectRepo.findById({ id: path.id });
        yield* assertOrgOwnership(project.organizationId);

        const { patchR2Keys } = yield* projectRepo.delete({ id: path.id });

        // Clean up patch R2 blobs in batches (R2 API limit: 1000 keys per call)
        if (patchR2Keys.length > 0) {
          const env = yield* cloudflareEnv;
          yield* Effect.forEach(
            chunkArray(patchR2Keys, R2_BATCH_SIZE),
            (batch) =>
              Effect.catchAll(
                Effect.promise(async () => env.ASSETS_BUCKET.delete(batch)),
                (error) =>
                  Effect.logWarning("Failed to delete patch R2 blobs", {
                    error,
                    count: batch.length,
                  }),
              ),
            { concurrency: 1 },
          );
        }

        return { deleted: 1 };
      }),
    ),
);
