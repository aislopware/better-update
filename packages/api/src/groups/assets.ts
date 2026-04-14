import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { AssetUploadBody, AssetUploadResult } from "../domain/asset";
import { BadRequest } from "../domain/errors";

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
  .addError(BadRequest)
  .addError(NotFound)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Assets",
      description: "Asset upload endpoints",
    }),
  ) {}
