import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { BadRequest } from "../domain/errors";
import { CreateInvitationBody, Invitation, InvitationList } from "../domain/invitation";

export const InvitationsGroup = HttpApiGroup.make("invitations")
  .add(
    HttpApiEndpoint.get("list", "/api/invitations", {
      success: InvitationList,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List invitations",
        description: "List the active organization's invitations (all statuses, newest first)",
      }),
    ),
    HttpApiEndpoint.post("create", "/api/invitations", {
      payload: CreateInvitationBody,
      success: Invitation.pipe(HttpApiSchema.status(201)),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create invitation",
        description:
          "Invite a member to the active organization. Writes a pending `invitation` row (better-auth's accept-invitation consumes it) and sends the invite email",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("cancel", "/api/invitations/:id", {
      params: { ...idParam },
      success: DeletedResult,
      error: [NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Cancel invitation",
        description:
          "Cancel a pending invitation by id (org-scoped). A canceled invitation can no longer be accepted",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Invitations",
      description: "IAM-gated organization invitation create / list / cancel",
    }),
  );
