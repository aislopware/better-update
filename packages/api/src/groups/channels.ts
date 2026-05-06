import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  Channel,
  CreateBranchRolloutBody,
  CreateChannelBody,
  DeleteChannelResult,
  ListChannelsParams,
  UpdateChannelBody,
} from "../domain/channel";
import { UpdateRolloutBody } from "../domain/common";
import { Conflict } from "../domain/errors";

const idParam = HttpApiSchema.param("id", Schema.String);

export class ChannelsGroup extends HttpApiGroup.make("channels")
  .add(
    HttpApiEndpoint.post("create", "/api/channels")
      .setPayload(CreateChannelBody)
      .addSuccess(Channel, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create channel",
          description: "Create a new channel linked to a branch",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("update")`/api/channels/${idParam}`
      .setPayload(UpdateChannelBody)
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Update channel",
          description: "Relink channel to a different branch",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("list", "/api/channels")
      .setUrlParams(ListChannelsParams)
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(Channel),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
      .annotateContext(
        OpenApi.annotations({
          title: "List channels",
          description: "List all channels for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("pause")`/api/channels/${idParam}/pause`
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Pause channel",
          description: "Pause a channel — manifest requests return 204 No Content",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("resume")`/api/channels/${idParam}/resume`
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Resume channel",
          description: "Resume a paused channel",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("createBranchRollout")`/api/channels/${idParam}/rollout`
      .setPayload(CreateBranchRolloutBody)
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Create branch rollout",
          description: "Start a gradual rollout to a new branch on this channel",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("updateBranchRollout")`/api/channels/${idParam}/rollout`
      .setPayload(UpdateRolloutBody)
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Update branch rollout",
          description: "Change the rollout percentage for a branch rollout",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("completeBranchRollout")`/api/channels/${idParam}/rollout/complete`
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Complete branch rollout",
          description: "Finalize the rollout — promote the new branch to 100%",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("revertBranchRollout")`/api/channels/${idParam}/rollout/revert`
      .addSuccess(Channel)
      .annotateContext(
        OpenApi.annotations({
          title: "Revert branch rollout",
          description: "Revert the rollout — restore the original branch",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/channels/${idParam}`
      .addSuccess(DeleteChannelResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete channel",
          description: "Delete a channel",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Channels",
      description: "Channel management endpoints including pause/resume and branch rollouts",
    }),
  ) {}
