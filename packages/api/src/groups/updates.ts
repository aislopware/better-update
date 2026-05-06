import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { UpdateRolloutBody } from "../domain/common";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateUpdateBody,
  DeleteUpdateResult,
  ListUpdatesParams,
  RepublishBody,
  RepublishResult,
  Update,
} from "../domain/update";

const idParam = HttpApiSchema.param("id", Schema.String);
const groupIdParam = HttpApiSchema.param("groupId", Schema.String);

export class UpdatesGroup extends HttpApiGroup.make("updates")
  .add(
    HttpApiEndpoint.post("create", "/api/updates")
      .setPayload(CreateUpdateBody)
      .addSuccess(Update, { status: 201 })
      .addError(Conflict)
      .annotateContext(
        OpenApi.annotations({
          title: "Create update",
          description: "Publish a new update (manifest + directive) to a branch",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/updates")
      .setUrlParams(ListUpdatesParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(Update),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List updates",
          description: "List updates for a project, optionally filtered by branch",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("deleteGroup")`/api/updates/${groupIdParam}`
      .addSuccess(DeleteUpdateResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete update group",
          description: "Delete all updates in a group (paired iOS + Android updates)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("republish", "/api/updates/republish")
      .setPayload(RepublishBody)
      .addSuccess(RepublishResult)
      .addError(Conflict)
      .annotateContext(
        OpenApi.annotations({
          title: "Republish update",
          description: "Cross-channel republish (promote) an update",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("editRollout")`/api/updates/${idParam}/rollout`
      .setPayload(UpdateRolloutBody)
      .addSuccess(Update)
      .annotateContext(
        OpenApi.annotations({
          title: "Edit per-update rollout",
          description: "Change the rollout percentage for a specific update",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("completeRollout")`/api/updates/${idParam}/rollout/complete`
      .addSuccess(Update)
      .annotateContext(
        OpenApi.annotations({
          title: "Complete per-update rollout",
          description: "End rollout — make update available to all devices",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("revertRollout")`/api/updates/${idParam}/rollout/revert`
      .addSuccess(Update)
      .annotateContext(
        OpenApi.annotations({
          title: "Revert per-update rollout",
          description: "End rollout — revert to previous update",
        }),
      ),
  )
  .addError(BadRequest)
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Updates",
      description: "Update publishing, deletion, republish, and per-update rollout endpoints",
    }),
  ) {}
