import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  CreateEnvironmentBody,
  DeleteEnvironmentResult,
  Environment,
  EnvironmentListResult,
  RenameEnvironmentBody,
} from "../domain/environment";
import { BadRequest, Conflict } from "../domain/errors";

/** `:name` path parameter — the environment name (built-in or user-defined). */
const nameParam = HttpApiSchema.param("name", Schema.String);

export class EnvironmentsGroup extends HttpApiGroup.make("environments")
  .add(
    HttpApiEndpoint.get("list", "/api/environments")
      .addSuccess(EnvironmentListResult)
      .annotateContext(
        OpenApi.annotations({
          title: "List environments",
          description:
            "List the organization's environments: the three built-ins (development, preview, production) followed by user-defined ones.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/environments")
      .setPayload(CreateEnvironmentBody)
      .addSuccess(Environment, { status: 201 })
      .addError(Conflict)
      .addError(BadRequest)
      .annotateContext(
        OpenApi.annotations({
          title: "Create environment",
          description:
            "Create a user-defined environment for the organization. Built-in names are reserved.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("rename")`/api/environments/${nameParam}`
      .setPayload(RenameEnvironmentBody)
      .addSuccess(Environment)
      .addError(Conflict)
      .addError(BadRequest)
      .annotateContext(
        OpenApi.annotations({
          title: "Rename environment",
          description:
            "Rename a user-defined environment. Built-ins cannot be renamed. Env vars referencing the old name are re-pointed at the new name.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/environments/${nameParam}`
      .addSuccess(DeleteEnvironmentResult)
      .addError(Conflict)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete environment",
          description:
            "Delete a user-defined environment. Built-ins cannot be deleted, nor can an environment still referenced by env vars.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Environments",
      description: "Organization environment management endpoints",
    }),
  ) {}
