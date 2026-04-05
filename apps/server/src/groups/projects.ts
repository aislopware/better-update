import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { PaginationParams } from "../domain/common";
import { Conflict } from "../domain/errors";
import { CreateProjectBody, Project } from "../domain/project";

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
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Projects",
      description: "Project management endpoints",
    }),
  ) {}
