import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import {
  Asset,
  AssetUploadBody,
  AssetUploadResult,
  PatchUploadBody,
  PatchUploadResult,
} from "../domain/asset";
import { BadRequest } from "../domain/errors";

const hashParam = HttpApiSchema.param("hash", Schema.String);

export class AssetsGroup extends HttpApiGroup.make("assets")
  .add(
    HttpApiEndpoint.post("upload", "/api/assets/upload")
      .setPayload(AssetUploadBody)
      .addSuccess(AssetUploadResult, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Upload assets",
          description: "Upload asset files to R2 storage (deduplicated by content hash)",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("patchUpload", "/api/assets/patch-upload")
      .setPayload(PatchUploadBody)
      .addSuccess(PatchUploadResult, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Presign patch upload",
          description:
            "Mint a presigned PUT for a precomputed bsdiff patch; the R2 key is built server-side from the request tuple",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("finalize")`/api/assets/${hashParam}/finalize`
      .addSuccess(Asset)
      .annotateContext(
        OpenApi.annotations({
          title: "Finalize asset upload",
          description: "Verify a directly uploaded asset in R2 and mark it available for updates",
        }),
      ),
  )
  .addError(BadRequest)
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Assets",
      description: "Asset upload endpoints",
    }),
  ) {}
