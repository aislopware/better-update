import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateProjectBody,
  DeleteProjectResult,
  ListProjectsParams,
  Project,
  ProjectLogoUploadBody,
  ProjectLogoUploadResult,
  UpdateProjectBody,
} from "../domain/project";

const slugParam = HttpApiSchema.param("slug", Schema.String);

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
      .setUrlParams(ListProjectsParams)
      .addSuccess(pageResult(Project))
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
    HttpApiEndpoint.get("getBySlug")`/api/projects/by-slug/${slugParam}`
      .addSuccess(Project)
      .annotateContext(
        OpenApi.annotations({
          title: "Get project by slug",
          description: "Get a single project by slug within the caller's active organization",
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
    HttpApiEndpoint.post("createLogoUploadUrl")`/api/projects/${idParam}/logo/upload-url`
      .setPayload(ProjectLogoUploadBody)
      .addSuccess(ProjectLogoUploadResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Create project logo upload URL",
          description:
            "Request a presigned PUT URL to upload a project logo directly to object " +
            "storage. Send the returned headers with the upload, then call “Set project " +
            "logo” to finalize.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("setLogo")`/api/projects/${idParam}/logo`
      .addSuccess(Project)
      .annotateContext(
        OpenApi.annotations({
          title: "Set project logo",
          description:
            "Finalize a project logo after its bytes were uploaded via the presigned URL: " +
            "validates the stored object and records its public CDN URL on the project.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("removeLogo")`/api/projects/${idParam}/logo`
      .addSuccess(Project)
      .annotateContext(
        OpenApi.annotations({
          title: "Remove project logo",
          description: "Remove the project logo, clearing it back to the default avatar",
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
  .add(
    HttpApiEndpoint.post("archive")`/api/projects/${idParam}/archive`
      .addSuccess(Project)
      .annotateContext(
        OpenApi.annotations({
          title: "Archive project",
          description:
            "Archive a project: it is hidden from the default project list and becomes " +
            "read-only (publishes, builds and other writes are blocked) until unarchived. " +
            "OTA serving to existing devices is unaffected. Reversible.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("unarchive")`/api/projects/${idParam}/unarchive`
      .addSuccess(Project)
      .annotateContext(
        OpenApi.annotations({
          title: "Unarchive project",
          description: "Restore an archived project to active, writable state",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Projects",
      description: "Project management endpoints",
    }),
  ) {}
