import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { pageResult } from "../domain/common";
import { Conflict } from "../domain/errors";
import { ListRuntimesParams, RuntimeAggregate } from "../domain/runtime";

export const RuntimesGroup = HttpApiGroup.make("runtimes")
  .add(
    HttpApiEndpoint.get("list", "/api/runtimes", {
      query: ListRuntimesParams,
      success: pageResult(RuntimeAggregate),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List runtimes",
        description:
          "Aggregate runtime versions across a project's builds and updates, newest activity first",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Runtimes",
      description: "Runtime version aggregation endpoints",
    }),
  );
