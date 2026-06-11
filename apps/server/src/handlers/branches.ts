import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { Conflict } from "../errors";
import { toApiBranch } from "../http/to-api";
import { toApiCrudEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { BranchRepo } from "../repositories/branches";
import { ProjectRepo } from "../repositories/projects";

import type { BranchSortKey, BranchSortOrder } from "../repositories/branches";

const parseBranchSort = (
  value: string | undefined = "-createdAt",
): { readonly sort: BranchSortKey; readonly order: BranchSortOrder } => {
  const order: BranchSortOrder = value.startsWith("-") ? "desc" : "asc";
  const column = value.startsWith("-") ? value.slice(1) : value;
  switch (column) {
    case "name":
    case "createdAt":
    case "updateCount": {
      return { sort: column, order };
    }
    default: {
      return { sort: "createdAt", order: "desc" };
    }
  }
};

export const BranchesGroupLive = HttpApiBuilder.group(ManagementApi, "branches", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(payload.projectId);
          yield* assertAccess("branch", "create", {
            kind: "project",
            projectId: payload.projectId,
          });
          const repo = yield* BranchRepo;
          const projectRepo = yield* ProjectRepo;
          const id = crypto.randomUUID();
          const now = new Date().toISOString();

          const branch = {
            id,
            projectId: payload.projectId,
            name: payload.name,
            isBuiltin: false,
            createdAt: now,
            updateCount: 0,
          };

          yield* repo.insert(branch);
          yield* projectRepo.bumpLastActivity({ projectId: payload.projectId, at: now });

          yield* logAudit({
            action: "branch.create",
            resourceType: "branch",
            resourceId: branch.id,
            projectId: payload.projectId,
            metadata: { name: payload.name, projectId: payload.projectId },
          });

          return toApiBranch(branch);
        }),
      ),
    )
    .handle("list", ({ urlParams }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          yield* assertProjectOwnership(urlParams.projectId);
          yield* assertAccess("branch", "read", {
            kind: "project",
            projectId: urlParams.projectId,
          });
          const repo = yield* BranchRepo;
          const { page, limit, offset } = parsePagination(urlParams);
          const { sort, order } = parseBranchSort(urlParams.sort);

          const { items, total } = yield* repo.findByProject({
            projectId: urlParams.projectId,
            ...(urlParams.query ? { query: urlParams.query } : {}),
            sort,
            order,
            limit,
            offset,
          });

          return { items: items.map(toApiBranch), total, page, limit };
        }),
      ),
    )
    .handle("get", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          const branch = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(branch.projectId);
          yield* assertAccess("branch", "read", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });
          return toApiBranch(branch);
        }),
      ),
    )
    .handle("rename", ({ path, payload }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const repo = yield* BranchRepo;
          const branch = yield* repo.findById({ id: path.id });
          yield* assertProjectOwnership(branch.projectId);
          yield* assertAccess("branch", "update", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });
          if (branch.isBuiltin) {
            return yield* new Conflict({
              message: `Built-in branch "${branch.name}" cannot be renamed`,
            });
          }
          yield* repo.updateName({ id: path.id, name: payload.name });

          yield* logAudit({
            action: "branch.rename",
            resourceType: "branch",
            resourceId: path.id,
            projectId: branch.projectId,
            metadata: { name: payload.name },
          });

          return toApiBranch({ ...branch, name: payload.name });
        }),
      ),
    )
    .handle("delete", ({ path }) =>
      toApiCrudEffect(
        Effect.gen(function* () {
          const branchRepo = yield* BranchRepo;
          const branch = yield* branchRepo.findById({ id: path.id });
          yield* assertProjectOwnership(branch.projectId);
          yield* assertAccess("branch", "delete", {
            kind: "environment",
            projectId: branch.projectId,
            environment: branch.name,
          });
          if (branch.isBuiltin) {
            return yield* new Conflict({
              message: `Built-in branch "${branch.name}" cannot be deleted`,
            });
          }
          yield* branchRepo.delete({ id: path.id });

          yield* logAudit({
            action: "branch.delete",
            resourceType: "branch",
            resourceId: path.id,
            projectId: branch.projectId,
          });

          return { deleted: 1 };
        }),
      ),
    ),
);
