import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { CreateInvitationBody, Invitation, InvitationList } from "../domain/invitation";

export class InvitationsGroup extends HttpApiGroup.make("invitations")
  .add(
    HttpApiEndpoint.get("list", "/api/invitations")
      .addSuccess(InvitationList)
      .annotateContext(
        OpenApi.annotations({
          title: "List invitations",
          description: "List the active organization's invitations (all statuses, newest first)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/invitations")
      .setPayload(CreateInvitationBody)
      .addSuccess(Invitation, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create invitation",
          description:
            "Invite a member to the active organization. Writes a pending `invitation` row (better-auth's accept-invitation consumes it) and sends the invite email",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("cancel")`/api/invitations/${idParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Cancel invitation",
          description:
            "Cancel a pending invitation by id (org-scoped). A canceled invitation can no longer be accepted",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Invitations",
      description: "IAM-gated organization invitation create / list / cancel",
    }),
  ) {}
