import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { Conflict } from "../domain/errors";

const UpdateMemberRoleBody = Schema.Struct({
  role: Schema.Literal("admin", "member"),
});

const UpdatedMemberRole = Schema.Struct({
  id: Schema.String,
  role: Schema.Literal("admin", "member"),
});

export class MembersGroup extends HttpApiGroup.make("members")
  .add(
    HttpApiEndpoint.patch("updateRole")`/api/members/${idParam}`
      .setPayload(UpdateMemberRoleBody)
      .addSuccess(UpdatedMemberRole)
      .annotateContext(
        OpenApi.annotations({
          title: "Change member org role",
          description:
            "Set a member's org role (GITLAB-RBAC-SPEC §2): admin ⇄ member. Requires member:update; granting OR revoking admin is owner-only. Owners cannot be changed here (owner is the org root, set at creation).",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("remove")`/api/members/${idParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Remove member",
          description:
            "Remove a member from the active organization by member id (org-scoped; no cross-organization removes). Rejects removing the last owner (409). Also drops the member's project_member rows.",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Members",
      description: "IAM-gated organization member management (org role + removal)",
    }),
  ) {}
