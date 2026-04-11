import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { PaginationParams } from "../domain/common";
import { Conflict } from "../domain/errors";
import {
  CreateProjectBody,
  DeleteProjectResult,
  Project,
  UpdateProjectBody,
} from "../domain/project";

const idParam = HttpApiSchema.param("id", Schema.String);

export class ProjectsGroup extends HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.post("create", "/api/projects")
      .setPayload(CreateProjectBody)
      .addSuccess(Project, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create project",
          description: "Create a new project in the caller's active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/projects")
      .setUrlParams(PaginationParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(Project),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List projects",
          description: "List all projects in the caller's active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/projects/${idParam}`.addSuccess(Project).annotateContext(
      OpenApi.annotations({
        title: "Get project",
        description: "Get a single project by ID",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("rename")`/api/projects/${idParam}`
      .setPayload(UpdateProjectBody)
      .addSuccess(Project)
      .annotateContext(
        OpenApi.annotations({
          title: "Rename project",
          description: "Rename a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/projects/${idParam}`
      .addSuccess(DeleteProjectResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete project",
          description: "Delete a project and all its branches, channels, and updates",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Projects",
      description: "Project management endpoints",
    }),
  ) {}
