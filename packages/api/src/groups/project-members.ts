import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  ProjectMember,
  ProjectMemberList,
  RemoveProjectMemberParams,
  UpdateProjectMemberBody,
  UpsertProjectMemberBody,
} from "../domain/project-member";

const principalIdParam = { principalId: Schema.String };

export const ProjectMembersGroup = HttpApiGroup.make("project-members")
  .add(
    HttpApiEndpoint.get("list", "/api/projects/:id/members", {
      params: { ...idParam },
      success: ProjectMemberList,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List project members",
        description:
          "Members and robots holding a role on this project (GITLAB-RBAC-SPEC §1). Org owner/admin are implicit maintainers and never appear here. Requires Reporter+ on the project.",
      }),
    ),
    HttpApiEndpoint.post("add", "/api/projects/:id/members", {
      params: { ...idParam },
      payload: UpsertProjectMemberBody,
      success: ProjectMember.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Add project member",
        description:
          "Grant a principal (org member or robot) a role on this project — idempotent upsert. Requires Maintainer+ on the project.",
      }),
    ),
    HttpApiEndpoint.patch("updateRole", "/api/projects/:id/members/:principalId", {
      params: { ...idParam, ...principalIdParam },
      payload: UpdateProjectMemberBody,
      success: ProjectMember,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Change project member role",
        description: "Set an existing project member's role. Requires Maintainer+ on the project.",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("remove", "/api/projects/:id/members/:principalId", {
      params: { ...idParam, ...principalIdParam },
      query: RemoveProjectMemberParams,
      success: DeletedResult,
      error: [NotFound, Conflict, BadRequest, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Remove project member",
        description:
          "Drop a principal's role on this project. Requires Maintainer+ on the project.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Project members",
      description: "Per-project membership management (GitLab-style RBAC)",
    }),
  );
