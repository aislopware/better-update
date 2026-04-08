import { Branch } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { BranchRepo } from "../repositories/branches";

export const BranchesGroupLive = HttpApiBuilder.group(ManagementApi, "branches", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("branch", "create");
        yield* assertProjectOwnership(payload.projectId);
        const repo = yield* BranchRepo;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        yield* repo.insert({
          id,
          projectId: payload.projectId,
          name: payload.name,
          createdAt: now,
        });

        return new Branch({ id, projectId: payload.projectId, name: payload.name, createdAt: now });
      }),
    )
    .handle("list", ({ urlParams }) =>
      Effect.gen(function* () {
        yield* assertPermission("branch", "read");
        yield* assertProjectOwnership(urlParams.projectId);
        const repo = yield* BranchRepo;
        const page = urlParams.page ?? 1;
        const limit = urlParams.limit ?? 20;
        const offset = (page - 1) * limit;

        const { items, total } = yield* repo.findByProject({
          projectId: urlParams.projectId,
          limit,
          offset,
        });

        return { items, total, page, limit };
      }),
    )
    .handle("rename", ({ path, payload }) =>
      Effect.gen(function* () {
        yield* assertPermission("branch", "update");
        const repo = yield* BranchRepo;
        const branch = yield* repo.findById({ id: path.id });
        yield* assertProjectOwnership(branch.projectId);
        yield* repo.updateName({ id: path.id, name: payload.name });

        return new Branch({
          id: branch.id,
          projectId: branch.projectId,
          name: payload.name,
          createdAt: branch.createdAt,
        });
      }),
    ),
);
