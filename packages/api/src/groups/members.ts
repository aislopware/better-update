import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { Conflict } from "../domain/errors";
import { MemberAccessSummaryList } from "../domain/member-access";

export class MembersGroup extends HttpApiGroup.make("members")
  .add(
    HttpApiEndpoint.get("accessSummaries", "/api/members/access-summaries")
      .addSuccess(MemberAccessSummaryList)
      .annotateContext(
        OpenApi.annotations({
          title: "Member access summaries",
          description:
            "Server-computed access summary per member (org role, project roles, capabilities, custom-policy count) — direct attachments plus group-conferred grants. Feeds the Members table's Access column.",
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
            "Remove a member from the active organization by member id (org-scoped; no cross-organization removes). Rejects removing the last owner (409). Membership role is `owner | member`; admin/developer/viewer access comes from policy attachments, not the role",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Members",
      description: "IAM-gated organization member removal",
    }),
  ) {}
