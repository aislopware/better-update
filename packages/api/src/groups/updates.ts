import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

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
      .addSuccess(pageResult(Update))
      .annotateContext(
        OpenApi.annotations({
          title: "List updates",
          description: "List updates for a project, optionally filtered by branch",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listPatchBases", "/api/updates/patch-bases")
      .setUrlParams(ListPatchBasesParams)
      .addSuccess(Schema.Array(PatchBaseCandidate))
      .annotateContext(
        OpenApi.annotations({
          title: "List patch-base candidates",
          description:
            "Recent published updates + embedded baseline (with launch-asset hashes) the CLI can diff a new bundle against to produce bsdiff patches",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("get")`/api/updates/${idParam}`.addSuccess(Update).annotateContext(
      OpenApi.annotations({
        title: "Get update",
        description: "Fetch a single update by ID",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("getGroup")`/api/update-groups/${groupIdParam}`
      .addSuccess(Schema.Struct({ items: Schema.Array(Update) }))
      .annotateContext(
        OpenApi.annotations({
          title: "Get update group",
          description: "Fetch all updates in a group (paired iOS + Android variants)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("listAssets")`/api/updates/${idParam}/assets`
      .addSuccess(Schema.Array(UpdateAssetEntry))
      .annotateContext(
        OpenApi.annotations({
          title: "List update assets",
          description: "Fetch the asset references (key + hash + launch flag) for an update",
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
    HttpApiEndpoint.post("reserveSourcemap")`/api/updates/${idParam}/sourcemap`
      .setPayload(ReserveSourcemapBody)
      .addSuccess(DebugUploadReservation, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Reserve update sourcemap",
          description: "Get a presigned upload URL for the JS bundle sourcemap of an update",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("completeSourcemap")`/api/updates/${idParam}/sourcemap/complete`
      .setPayload(CompleteSourcemapBody)
      .addSuccess(UpdateSourcemap)
      .annotateContext(
        OpenApi.annotations({
          title: "Complete update sourcemap",
          description: "Finalize an update sourcemap after upload",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getSourcemap")`/api/updates/${idParam}/sourcemap`
      .addSuccess(Schema.NullOr(UpdateSourcemap))
      .annotateContext(
        OpenApi.annotations({
          title: "Get update sourcemap",
          description: "Fetch the stored sourcemap metadata for an update (null when absent)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("getSourcemapDownload")`/api/updates/${idParam}/sourcemap/download`
      .addSuccess(DebugDownloadResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Download update sourcemap",
          description: "Get a short-lived presigned download URL for an update sourcemap",
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
