import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { idParam, pageResult, UpdateRolloutBody } from "../domain/common";
import {
  CompleteSourcemapBody,
  DebugDownloadResult,
  DebugUploadReservation,
  ReserveSourcemapBody,
  UpdateSourcemap,
} from "../domain/debug-artifact";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateUpdateBody,
  DeleteUpdateResult,
  ListPatchBasesParams,
  ListUpdatesParams,
  PatchBaseCandidate,
  RepublishBody,
  RepublishResult,
  Update,
  UpdateAssetEntry,
} from "../domain/update";

const groupIdParam = { groupId: Schema.String };

export const UpdatesGroup = HttpApiGroup.make("updates")
  .add(
    HttpApiEndpoint.post("create", "/api/updates", {
      payload: CreateUpdateBody,
      success: Update.pipe(HttpApiSchema.status(201)),
      error: [Conflict, BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Create update",
        description: "Publish a new update (manifest + directive) to a branch",
      }),
    ),
    HttpApiEndpoint.get("list", "/api/updates", {
      query: ListUpdatesParams,
      success: pageResult(Update),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List updates",
        description: "List updates for a project, optionally filtered by branch",
      }),
    ),
    HttpApiEndpoint.get("listPatchBases", "/api/updates/patch-bases", {
      query: ListPatchBasesParams,
      success: Schema.Array(PatchBaseCandidate),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List patch-base candidates",
        description:
          "Recent published updates + embedded baseline (with launch-asset hashes) the CLI can diff a new bundle against to produce bsdiff patches",
      }),
    ),
    HttpApiEndpoint.get("get", "/api/updates/:id", {
      params: { ...idParam },
      success: Update,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get update",
        description: "Fetch a single update by ID",
      }),
    ),
    HttpApiEndpoint.get("getGroup", "/api/update-groups/:groupId", {
      params: { ...groupIdParam },
      success: Schema.Struct({ items: Schema.Array(Update) }),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get update group",
        description: "Fetch all updates in a group (paired iOS + Android variants)",
      }),
    ),
    HttpApiEndpoint.get("listAssets", "/api/updates/:id/assets", {
      params: { ...idParam },
      success: Schema.Array(UpdateAssetEntry),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List update assets",
        description: "Fetch the asset references (key + hash + launch flag) for an update",
      }),
    ),
    HttpApiEndpoint.make("DELETE")("deleteGroup", "/api/updates/:groupId", {
      params: { ...groupIdParam },
      success: DeleteUpdateResult,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Delete update group",
        description: "Delete all updates in a group (paired iOS + Android updates)",
      }),
    ),
    HttpApiEndpoint.post("republish", "/api/updates/republish", {
      payload: RepublishBody,
      success: RepublishResult,
      error: [Conflict, BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Republish update",
        description: "Cross-channel republish (promote) an update",
      }),
    ),
    HttpApiEndpoint.patch("editRollout", "/api/updates/:id/rollout", {
      params: { ...idParam },
      payload: UpdateRolloutBody,
      success: Update,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Edit per-update rollout",
        description: "Change the rollout percentage for a specific update",
      }),
    ),
    HttpApiEndpoint.post("completeRollout", "/api/updates/:id/rollout/complete", {
      params: { ...idParam },
      success: Update,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Complete per-update rollout",
        description: "End rollout — make update available to all devices",
      }),
    ),
    HttpApiEndpoint.post("reserveSourcemap", "/api/updates/:id/sourcemap", {
      params: { ...idParam },
      payload: ReserveSourcemapBody,
      success: DebugUploadReservation.pipe(HttpApiSchema.status(201)),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Reserve update sourcemap",
        description: "Get a presigned upload URL for the JS bundle sourcemap of an update",
      }),
    ),
    HttpApiEndpoint.post("completeSourcemap", "/api/updates/:id/sourcemap/complete", {
      params: { ...idParam },
      payload: CompleteSourcemapBody,
      success: UpdateSourcemap,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Complete update sourcemap",
        description: "Finalize an update sourcemap after upload",
      }),
    ),
    HttpApiEndpoint.get("getSourcemap", "/api/updates/:id/sourcemap", {
      params: { ...idParam },
      success: Schema.NullOr(UpdateSourcemap),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Get update sourcemap",
        description: "Fetch the stored sourcemap metadata for an update (null when absent)",
      }),
    ),
    HttpApiEndpoint.get("getSourcemapDownload", "/api/updates/:id/sourcemap/download", {
      params: { ...idParam },
      success: DebugDownloadResult,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Download update sourcemap",
        description: "Get a short-lived presigned download URL for an update sourcemap",
      }),
    ),
    HttpApiEndpoint.post("revertRollout", "/api/updates/:id/rollout/revert", {
      params: { ...idParam },
      success: Update,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Revert per-update rollout",
        description: "End rollout — revert to previous update",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Updates",
      description: "Update publishing, deletion, republish, and per-update rollout endpoints",
    }),
  );
