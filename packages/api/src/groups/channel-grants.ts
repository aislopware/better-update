import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  ChannelGrant,
  DeleteChannelGrantResult,
  ListChannelGrantsParams,
  UpsertChannelGrantBody,
} from "../domain/channel-grant";
import { idParam } from "../domain/common";

const memberIdParam = HttpApiSchema.param("memberId", Schema.String);

export class ChannelGrantsGroup extends HttpApiGroup.make("channelGrants")
  .add(
    HttpApiEndpoint.get("list")`/api/channels/${idParam}/grants`
      .setUrlParams(ListChannelGrantsParams)
      .addSuccess(Schema.Array(ChannelGrant))
      .annotateContext(
        OpenApi.annotations({
          title: "List channel grants",
          description: "List all per-member allow/deny grants on a channel",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("upsert")`/api/channels/${idParam}/grants/${memberIdParam}`
      .setPayload(UpsertChannelGrantBody)
      .addSuccess(ChannelGrant)
      .annotateContext(
        OpenApi.annotations({
          title: "Upsert channel grant",
          description: "Create or replace a member's allow/deny grant on a channel",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/channels/${idParam}/grants/${memberIdParam}`
      .addSuccess(DeleteChannelGrantResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete channel grant",
          description: "Revoke a member's grants on a channel",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Channel grants",
      description: "Per-channel ABAC permission grants (allow/deny by member)",
    }),
  ) {}
