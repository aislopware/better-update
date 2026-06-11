import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertProjectOwnership } from "../auth/ownership";
import { assertAccess } from "../auth/policy";
import { toApiCrudEffect } from "../http/to-api-effect";
import { parsePagination } from "../lib/pagination";
import { RuntimeRepo } from "../repositories/runtimes";

export const RuntimesGroupLive = HttpApiBuilder.group(ManagementApi, "runtimes", (handlers) =>
  handlers.handle("list", ({ urlParams }) =>
    toApiCrudEffect(
      Effect.gen(function* () {
        yield* assertProjectOwnership(urlParams.projectId);
        // The aggregation reveals data from both builds and updates, so it
        // requires read access to both resources on the project.
        yield* assertAccess("build", "read", { kind: "build", projectId: urlParams.projectId });
        yield* assertAccess("update", "read", { kind: "project", projectId: urlParams.projectId });
        const repo = yield* RuntimeRepo;
        const { page, limit, offset } = parsePagination(urlParams);

        const { items, total } = yield* repo.findByProject({
          projectId: urlParams.projectId,
          limit,
          offset,
        });

        return { items: [...items], total, page, limit };
      }),
    ),
  ),
);
