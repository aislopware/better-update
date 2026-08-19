import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BuildWithArtifact } from "../domain/build";
import {
  Channel,
  CreateBranchRolloutBody,
  CreateChannelBody,
  DeleteChannelResult,
  ListChannelsParams,
  UpdateChannelBody,
} from "../domain/channel";
import { idParam, PaginationParams, pageResult, UpdateRolloutBody } from "../domain/common";
import { Conflict } from "../domain/errors";

export const ChannelsGroup = HttpApiGroup.make("channels")
  .add(
    HttpApiEndpoint.post("create", "/api/channels", {
      payload: CreateChannelBody,
      success: Channel.pipe(HttpApiSchema.status(201)),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create channel",
        description: "Create a new channel linked to a branch",
      }),
    ),
    HttpApiEndpoint.patch("update", "/api/channels/:id", {
      params: { ...idParam },
      payload: UpdateChannelBody,
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update channel",
        description: "Relink channel to a different branch",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/channels", {
      query: ListChannelsParams,
      success: pageResult(Channel),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List channels",
        description: "List all channels for a project",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/channels/:id", {
      params: { ...idParam },
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get channel",
        description: "Fetch a single channel by id",
      }),
    ),
    HttpApiEndpoint.get("listCompatibleBuilds", "/api/channels/:id/compatible-builds", {
      params: { ...idParam },
      query: PaginationParams,
      success: pageResult(BuildWithArtifact),
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List compatible builds",
        description:
          "List builds whose platform and runtime version can install an update currently served by this channel",
      }),
    ),
    HttpApiEndpoint.post("pause", "/api/channels/:id/pause", {
      params: { ...idParam },
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Pause channel",
        description: "Pause a channel — manifest requests return 204 No Content",
      }),
    ),
    HttpApiEndpoint.post("resume", "/api/channels/:id/resume", {
      params: { ...idParam },
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Resume channel",
        description: "Resume a paused channel",
      }),
    ),
    HttpApiEndpoint.post("createBranchRollout", "/api/channels/:id/rollout", {
      params: { ...idParam },
      payload: CreateBranchRolloutBody,
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create branch rollout",
        description: "Start a gradual rollout to a new branch on this channel",
      }),
    ),
    HttpApiEndpoint.patch("updateBranchRollout", "/api/channels/:id/rollout", {
      params: { ...idParam },
      payload: UpdateRolloutBody,
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Update branch rollout",
        description: "Change the rollout percentage for a branch rollout",
      }),
    ),
    HttpApiEndpoint.post("completeBranchRollout", "/api/channels/:id/rollout/complete", {
      params: { ...idParam },
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Complete branch rollout",
        description: "Finalize the rollout — promote the new branch to 100%",
      }),
    ),
    HttpApiEndpoint.post("revertBranchRollout", "/api/channels/:id/rollout/revert", {
      params: { ...idParam },
      success: Channel,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Revert branch rollout",
        description: "Revert the rollout — restore the original branch",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("delete", "/api/channels/:id", {
      params: { ...idParam },
      success: DeleteChannelResult,
      error: [NotFound, Conflict, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete channel",
        description: "Delete a channel",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Channels",
      description: "Channel management endpoints including pause/resume and branch rollouts",
    }),
  );
