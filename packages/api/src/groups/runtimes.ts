import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { pageResult } from "../domain/common";
import { Conflict } from "../domain/errors";
import { ListRuntimesParams, RuntimeAggregate } from "../domain/runtime";

export class RuntimesGroup extends HttpApiGroup.make("runtimes")
  .add(
    HttpApiEndpoint.get("list", "/api/runtimes")
      .setUrlParams(ListRuntimesParams)
      .addSuccess(pageResult(RuntimeAggregate))
      .annotateContext(
        OpenApi.annotations({
          title: "List runtimes",
          description:
            "Aggregate runtime versions across a project's builds and updates, newest activity first",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Runtimes",
      description: "Runtime version aggregation endpoints",
    }),
  ) {}
