import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { CurrentActor } from "../auth/current-actor";
import { assertOrgOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { toApiProject } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { BranchRepo } from "../repositories/branches";
import { ChannelRepo } from "../repositories/channels";
import { ProjectRepo } from "../repositories/projects";

import type { ProjectSortKey, ProjectSortOrder } from "../repositories/projects";

const DEFAULT_ENVIRONMENT_NAMES = ["production", "staging", "preview"] as const;

const parseProjectSort = (
  value: string | undefined = "-lastActivityAt",
): { readonly sort: ProjectSortKey; readonly order: ProjectSortOrder } => {
  const order: ProjectSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "name":
    case "lastActivityAt":
    case "createdAt":
    case "branchCount":
    case "channelCount":
    case "updateCount": {
      return { sort: column, order };
    }
    default: {
      return { sort: "lastActivityAt", order: "desc" };
    }
  }
};

export const ProjectsGroupLive = HttpApiBuilder.group(ManagementApi, "projects", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "create");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const branchRepo = yield* BranchRepo;
          const channelRepo = yield* ChannelRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          yield* repo.insert({
            id,
            organizationId: ctx.organizationId,
            name: payload.name,
            slug: payload.slug,
            createdAt: now,
          });

          yield* logAudit({
            action: "project.create",
            resourceType: "project",
            resourceId: id,
            projectId: id,
            metadata: { name: payload.name, slug: payload.slug },
          });

          yield* Effect.forEach(
            DEFAULT_ENVIRONMENT_NAMES,
            (envName) =>
              Effect.gen(function* () {
                const branchId = crypto.randomUUID();
                yield* branchRepo.insert({
                  id: branchId,
                  projectId: id,
                  name: envName,
                  createdAt: now,
                });
                yield* logAudit({
                  action: "branch.create",
                  resourceType: "branch",
                  resourceId: branchId,
                  projectId: id,
                  metadata: { name: envName, projectId: id },
                });

                const channel = yield* channelRepo.insert({
                  projectId: id,
                  name: envName,
                  branchId,
                });
                yield* logAudit({
                  action: "channel.create",
                  resourceType: "channel",
                  resourceId: channel.id,
                  projectId: id,
                  metadata: { name: envName, projectId: id },
                });
              }),
            { concurrency: 1 },
          );

          return toApiProject({
            id,
            organizationId: ctx.organizationId,
            name: payload.name,
            slug: payload.slug,
            createdAt: now,
            lastActivityAt: now,
            branchCount: DEFAULT_ENVIRONMENT_NAMES.length,
            channelCount: DEFAULT_ENVIRONMENT_NAMES.length,
            updateCount: 0,
          });
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const { page, limit, offset } = parsePagination(urlParams);

          const { sort, order } = parseProjectSort(urlParams.sort);
          const { items, total } = yield* repo.findByOrg({
            organizationId: ctx.organizationId,
            ...(urlParams.query ? { query: urlParams.query } : {}),
            sort,
            order,
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
    .handle("getBySlug", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertPermission("project", "read");
          const ctx = yield* CurrentActor;
          const repo = yield* ProjectRepo;
          const project = yield* repo.findBySlug({
            organizationId: ctx.organizationId,
            slug: path.slug,
          });
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
            projectId: path.id,
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
          yield* projectRepo.delete({ id: path.id });

          yield* logAudit({
            action: "project.delete",
            resourceType: "project",
            resourceId: path.id,
            projectId: path.id,
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
