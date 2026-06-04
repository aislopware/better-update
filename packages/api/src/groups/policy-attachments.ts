import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import { AttachPolicyBody, PolicyAttachment } from "../domain/policy-attachment";

/**
 * `:policyId` path parameter — a real `policy.id` or a managed preset id. Managed
 * ids contain a colon (`managed:admin`); the single path segment matches it as-is,
 * and clients URL-encode the colon when building the path.
 */
const policyIdParam = HttpApiSchema.param("policyId", Schema.String);

export class PolicyAttachmentsGroup extends HttpApiGroup.make("policy-attachments")
  .add(
    HttpApiEndpoint.get("listForMember")`/api/members/${idParam}/policies`
      .addSuccess(Schema.Struct({ items: Schema.Array(PolicyAttachment) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List member policy attachments",
          description: "List policies attached directly to an organization member",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("attachToMember")`/api/members/${idParam}/policies`
      .setPayload(AttachPolicyBody)
      .addSuccess(PolicyAttachment, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Attach policy to member",
          description: "Attach a policy (real or managed) directly to a member",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("detachFromMember")`/api/members/${idParam}/policies/${policyIdParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Detach policy from member",
          description: "Remove a policy attachment from a member",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listForGroup")`/api/groups/${idParam}/policies`
      .addSuccess(Schema.Struct({ items: Schema.Array(PolicyAttachment) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List group policy attachments",
          description: "List policies attached to a group",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("attachToGroup")`/api/groups/${idParam}/policies`
      .setPayload(AttachPolicyBody)
      .addSuccess(PolicyAttachment, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Attach policy to group",
          description: "Attach a policy (real or managed) to a group; members inherit it",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("detachFromGroup")`/api/groups/${idParam}/policies/${policyIdParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Detach policy from group",
          description: "Remove a policy attachment from a group",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listForApiKey")`/api/api-keys/${idParam}/policies`
      .addSuccess(Schema.Struct({ items: Schema.Array(PolicyAttachment) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List api-key policy attachments",
          description: "List policies attached to an api-key principal",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("attachToApiKey")`/api/api-keys/${idParam}/policies`
      .setPayload(AttachPolicyBody)
      .addSuccess(PolicyAttachment, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Attach policy to api-key",
          description: "Attach a policy (real or managed) to an api-key principal",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("detachFromApiKey")`/api/api-keys/${idParam}/policies/${policyIdParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Detach policy from api-key",
          description: "Remove a policy attachment from an api-key principal",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Policy Attachments",
      description: "Bindings of policies to member, group, and api-key principals",
    }),
  ) {}
