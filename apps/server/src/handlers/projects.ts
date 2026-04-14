import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { AssetStorage } from "../cloudflare/asset-storage";
import { toApiProject } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { ProjectRepo } from "../repositories/projects";

const R2_BATCH_SIZE = 1000;

const chunkArray = <T>(array: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(array.length / size) }, (_, idx) =>
    array.slice(idx * size, idx * size + size),
  );

export const ProjectsGroupLive = HttpApiBuilder.group(ManagementApi, "projects", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          const project = {
            id,
            organizationId: ctx.organizationId,
            name: payload.name,
            scopeKey: payload.scopeKey,
            createdAt: now,
          };

          yield* repo.insert(project);

          yield* logAudit({
            action: "project.create",
            resourceType: "project",
            resourceId: project.id,
            metadata: { name: payload.name, scopeKey: payload.scopeKey },
          });

          return toApiProject(project);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const page = urlParams.page ?? 1;
          const limit = urlParams.limit ?? 20;
          const offset = (page - 1) * limit;

          const { items, total } = yield* repo.findByOrg({
            organizationId: ctx.organizationId,
            limit,
            offset,
          });

          return { items: items.map(toApiProject), total, page, limit };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "read");
          const repo = yield* ProjectRepo;
          const project = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          return toApiProject(project);
        }),
      ),
    )
    .handle("rename", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "update");
          const repo = yield* ProjectRepo;
          const project = yield* repo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);
          yield* repo.updateName({ id: path.id, name: payload.name });

          yield* logAudit({
            action: "project.rename",
            resourceType: "project",
            resourceId: path.id,
            metadata: { name: payload.name },
          });

          return toApiProject({ ...project, name: payload.name });
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "delete");
          const projectRepo = yield* ProjectRepo;
          const project = yield* projectRepo.findById({ id: path.id });
          yield* assertOrgOwnership(project.organizationId);

          const { patchR2Keys } = yield* projectRepo.delete({ id: path.id });

          // Clean up patch R2 blobs in batches (R2 API limit: 1000 keys per call)
          if (patchR2Keys.length > 0) {
            const storage = yield* AssetStorage;
            yield* Effect.forEach(
              chunkArray(patchR2Keys, R2_BATCH_SIZE),
              (batch) =>
                Effect.catchAll(storage.deleteObjects({ keys: batch }), (error) =>
                  Effect.logWarning("Failed to delete patch R2 blobs", {
                    error,
                    count: batch.length,
                  }),
                ),
              { concurrency: 1 },
            );
          }

          yield* logAudit({
            action: "project.delete",
            resourceType: "project",
            resourceId: path.id,
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
