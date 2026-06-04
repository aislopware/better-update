import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { DeletedResult, idParam } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import { CreatePolicyBody, Policy, UpdatePolicyBody } from "../domain/policy";

export class PoliciesGroup extends HttpApiGroup.make("policies")
  .add(
    HttpApiEndpoint.get("list", "/api/policies")
      .addSuccess(Schema.Struct({ items: Schema.Array(Policy) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List policies",
          description:
            "List policies in the active organization, merging the read-only managed presets (admin/developer/viewer) into the list",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create", "/api/policies")
      .setPayload(CreatePolicyBody)
      .addSuccess(Policy, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create policy",
          description: "Create a named IAM policy document for the active organization",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/policies/${idParam}`.addSuccess(Policy).annotateContext(
      OpenApi.annotations({
        title: "Get policy",
        description: "Fetch a single policy by id, resolving real ids or managed:* preset ids",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/policies/${idParam}`
      .setPayload(UpdatePolicyBody)
      .addSuccess(Policy)
      .annotateContext(
        OpenApi.annotations({
          title: "Update policy",
          description:
            "Update a policy's name, description, or document; managed:* ids are rejected",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/policies/${idParam}`
      .addSuccess(DeletedResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete policy",
          description: "Delete a policy and sweep its attachments; managed:* ids are rejected",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Policies",
      description: "IAM policy documents (named, reusable permission grants)",
    }),
  ) {}
