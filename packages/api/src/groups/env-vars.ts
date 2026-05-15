import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { Id, PaginationParams } from "../domain/common";
import {
  BulkImportEnvVarsBody,
  BulkImportResult,
  CreateEnvVarBody,
  DeleteEnvVarResult,
  EnvVar,
  EnvVarEnvironment,
  EnvVarExportResult,
  EnvVarListScope,
  UpdateEnvVarBody,
} from "../domain/env-var";
import { BadRequest, Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class EnvVarsGroup extends HttpApiGroup.make("env-vars")
  .add(
    HttpApiEndpoint.post("create", "/api/env-vars")
      .setPayload(CreateEnvVarBody)
      .addSuccess(EnvVar, { status: 201 })
      .addError(BadRequest)
      .addError(Conflict)
      .annotateContext(
        OpenApi.annotations({
          title: "Create environment variable",
          description:
            "Create a new environment variable. Scope can be 'project' (requires projectId) or 'global' (organization-wide).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/env-vars")
      .setUrlParams(
        Schema.Struct({
          scope: Schema.optional(EnvVarListScope),
          projectId: Schema.optional(Id),
          environments: Schema.optional(Schema.String),
          search: Schema.optional(Schema.String),
          ...PaginationParams.fields,
        }),
      )
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(EnvVar),
        }),
      )
      .addError(BadRequest)
      .annotateContext(
        OpenApi.annotations({
          title: "List environment variables",
          description:
            "List environment variables. scope=all merges project + global vars with project overrides. environments is a comma-separated list. search matches key substring.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/env-vars/${idParam}`.addSuccess(EnvVar).annotateContext(
      OpenApi.annotations({
        title: "Get environment variable",
        description: "Get an environment variable by ID",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/env-vars/${idParam}`
      .setPayload(UpdateEnvVarBody)
      .addSuccess(EnvVar)
      .addError(BadRequest)
      .annotateContext(
        OpenApi.annotations({
          title: "Update environment variable",
          description: "Update value, visibility, or assigned environments",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/env-vars/${idParam}`
      .addSuccess(DeleteEnvVarResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete environment variable",
          description: "Delete an environment variable",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("bulkImport", "/api/env-vars/bulk-import")
      .setPayload(BulkImportEnvVarsBody)
      .addSuccess(BulkImportResult)
      .addError(BadRequest)
      .annotateContext(
        OpenApi.annotations({
          title: "Bulk import environment variables",
          description:
            "Import variables from a dotenv-formatted string. Applies to all selected environments. Supports KEY=VALUE format with # comments. Quoted values (single/double) are unquoted. Multiline values are not supported.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("export", "/api/env-vars/export")
      .setUrlParams(
        Schema.Struct({
          projectId: Id,
          environment: EnvVarEnvironment,
        }),
      )
      .addSuccess(EnvVarExportResult)
      .addError(Forbidden)
      .annotateContext(
        OpenApi.annotations({
          title: "Export environment variables",
          description:
            "Export environment variables for a project environment. Global org-scoped vars are merged in; project values override globals on key collision.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .addError(BadRequest)
  .annotateContext(
    OpenApi.annotations({
      title: "Environment Variables",
      description: "Manage environment variables for project builds and deployments",
    }),
  ) {}
