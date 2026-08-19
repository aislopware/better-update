import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

const slugParam = { slug: Schema.String };

export const ProjectsGroup = HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.post("create", "/api/projects", {
      payload: CreateProjectBody,
      success: Project.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create project",
        description: "Create a new project in the caller's active organization",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/projects", {
      query: ListProjectsParams,
      success: pageResult(Project),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List projects",
        description: "List all projects in the caller's active organization",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/projects/:id", {
      params: { ...idParam },
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get project",
        description: "Get a single project by ID",
      }),
    ),
    HttpApiEndpoint.get("getBySlug", "/api/projects/by-slug/:slug", {
      params: { ...slugParam },
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get project by slug",
        description: "Get a single project by slug within the caller's active organization",
      }),
    ),
    HttpApiEndpoint.patch("rename", "/api/projects/:id", {
      params: { ...idParam },
      payload: UpdateProjectBody,
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Rename project",
        description: "Rename a project",
      }),
    ),
    HttpApiEndpoint.post("createLogoUploadUrl", "/api/projects/:id/logo/upload-url", {
      params: { ...idParam },
      payload: ProjectLogoUploadBody,
      success: ProjectLogoUploadResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create project logo upload URL",
        description:
          "Request a presigned PUT URL to upload a project logo directly to object " +
          "storage. Send the returned headers with the upload, then call “Set project " +
          "logo” to finalize.",
      }),
    ),
    HttpApiEndpoint.put("setLogo", "/api/projects/:id/logo", {
      params: { ...idParam },
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Set project logo",
        description:
          "Finalize a project logo after its bytes were uploaded via the presigned URL: " +
          "validates the stored object and records its public CDN URL on the project.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("removeLogo", "/api/projects/:id/logo", {
      params: { ...idParam },
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Remove project logo",
        description: "Remove the project logo, clearing it back to the default avatar",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/projects/:id", {
      params: { ...idParam },
      success: DeleteProjectResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete project",
        description: "Delete a project and all its branches, channels, and updates",
      }),
    ),
    HttpApiEndpoint.post("archive", "/api/projects/:id/archive", {
      params: { ...idParam },
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Archive project",
        description:
          "Archive a project: it is hidden from the default project list and becomes " +
          "read-only (publishes, builds and other writes are blocked) until unarchived. " +
          "OTA serving to existing devices is unaffected. Reversible.",
      }),
    ),
    HttpApiEndpoint.post("unarchive", "/api/projects/:id/unarchive", {
      params: { ...idParam },
      success: Project,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Unarchive project",
        description: "Restore an archived project to active, writable state",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Projects",
      description: "Project management endpoints",
    }),
  );
