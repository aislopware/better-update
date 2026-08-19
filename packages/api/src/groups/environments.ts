import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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
const nameParam = { name: Schema.String };

export const EnvironmentsGroup = HttpApiGroup.make("environments")
  .add(
    HttpApiEndpoint.get("list", "/api/environments", {
      success: EnvironmentListResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List environments",
        description:
          "List the organization's environments: the three built-ins (development, preview, production) followed by user-defined ones.",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/environments", {
      payload: CreateEnvironmentBody,
      success: Environment.pipe(HttpApiSchema.status(201)),
      error: [Conflict, BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create environment",
        description:
          "Create a user-defined environment for the organization. Built-in names are reserved.",
      }),
    ),
    HttpApiEndpoint.patch("rename", "/api/environments/:name", {
      params: { ...nameParam },
      payload: RenameEnvironmentBody,
      success: Environment,
      error: [Conflict, BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Rename environment",
        description:
          "Rename a user-defined environment. Built-ins cannot be renamed. Env vars referencing the old name are re-pointed at the new name.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/environments/:name", {
      params: { ...nameParam },
      success: DeleteEnvironmentResult,
      error: [Conflict, NotFound, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete environment",
        description:
          "Delete a user-defined environment. Built-ins cannot be deleted, nor can an environment still referenced by env vars.",
      }),
    ),
    HttpApiEndpoint.put("protect", "/api/environments/:name/protection", {
      params: { ...nameParam },
      success: Environment,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Protect environment",
        description:
          "Mark an environment as protected: writes into it additionally require environment:update (Maintainer+ / Admin / a custom grant). Idempotent.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("unprotect", "/api/environments/:name/protection", {
      params: { ...nameParam },
      success: Environment,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unprotect environment",
        description: "Remove an environment's protection. Idempotent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Environments",
      description: "Organization environment management endpoints",
    }),
  );
