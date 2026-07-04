import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

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

const principalIdParam = HttpApiSchema.param("principalId", Schema.String);

export class ProjectMembersGroup extends HttpApiGroup.make("project-members")
  .add(
    HttpApiEndpoint.get("list")`/api/projects/${idParam}/members`
      .addSuccess(ProjectMemberList)
      .annotateContext(
        OpenApi.annotations({
          title: "List project members",
          description:
            "Members and robots holding a role on this project (GITLAB-RBAC-SPEC §1). Org owner/admin are implicit maintainers and never appear here. Requires Reporter+ on the project.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("add")`/api/projects/${idParam}/members`
      .setPayload(UpsertProjectMemberBody)
      .addSuccess(ProjectMember, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Add project member",
          description:
            "Grant a principal (org member or robot) a role on this project — idempotent upsert. Requires Maintainer+ on the project.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("updateRole")`/api/projects/${idParam}/members/${principalIdParam}`
      .setPayload(UpdateProjectMemberBody)
      .addSuccess(ProjectMember)
      .annotateContext(
        OpenApi.annotations({
          title: "Change project member role",
          description:
            "Set an existing project member's role. Requires Maintainer+ on the project.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("remove")`/api/projects/${idParam}/members/${principalIdParam}`
      .setUrlParams(RemoveProjectMemberParams)
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Remove project member",
          description:
            "Drop a principal's role on this project. Requires Maintainer+ on the project.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Project members",
      description: "Per-project membership management (GitLab-style RBAC)",
    }),
  ) {}
