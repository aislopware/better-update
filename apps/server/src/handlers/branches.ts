import { Branch } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { logAudit } from "../audit/logger";
import { assertProjectOwnership } from "../auth/ownership";
import { assertPermission } from "../auth/permissions";
import { cloudflareEnv } from "../cloudflare/context";
import { BranchRepo } from "../repositories/branches";

const R2_BATCH_SIZE = 1000;

const chunkArray = <T>(array: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(array.length / size) }, (_, idx) =>
    array.slice(idx * size, idx * size + size),
  );

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

        const branch = new Branch({
          id,
          projectId: payload.projectId,
          name: payload.name,
          createdAt: now,
        });

        yield* logAudit({
          action: "branch.create",
          resourceType: "branch",
          resourceId: branch.id,
          metadata: { name: payload.name, projectId: payload.projectId },
        });

        return branch;
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

        yield* logAudit({
          action: "branch.rename",
          resourceType: "branch",
          resourceId: path.id,
          metadata: { name: payload.name },
        });

        return new Branch({
          id: branch.id,
          projectId: branch.projectId,
          name: payload.name,
          createdAt: branch.createdAt,
        });
      }),
    )
    .handle("delete", ({ path }) =>
      Effect.gen(function* () {
        yield* assertPermission("branch", "delete");
        const branchRepo = yield* BranchRepo;
        const branch = yield* branchRepo.findById({ id: path.id });
        yield* assertProjectOwnership(branch.projectId);

        const { patchR2Keys } = yield* branchRepo.delete({ id: path.id });

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

        yield* logAudit({
          action: "branch.delete",
          resourceType: "branch",
          resourceId: path.id,
        });

        return { deleted: 1 };
      }),
    ),
);
