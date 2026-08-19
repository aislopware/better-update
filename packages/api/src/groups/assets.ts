import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

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

const hashParam = { hash: Schema.String };

export const AssetsGroup = HttpApiGroup.make("assets")
  .add(
    HttpApiEndpoint.post("upload", "/api/assets/upload", {
      payload: AssetUploadBody,
      success: AssetUploadResult.pipe(HttpApiSchema.status(201)),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Upload assets",
        description: "Upload asset files to R2 storage (deduplicated by content hash)",
      }),
    ),
    HttpApiEndpoint.post("patchUpload", "/api/assets/patch-upload", {
      payload: PatchUploadBody,
      success: PatchUploadResult.pipe(HttpApiSchema.status(201)),
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Presign patch upload",
        description:
          "Mint a presigned PUT for a precomputed bsdiff patch; the R2 key is built server-side from the request tuple",
      }),
    ),
    HttpApiEndpoint.post("finalize", "/api/assets/:hash/finalize", {
      params: { ...hashParam },
      success: Asset,
      error: [BadRequest, NotFound, Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "Finalize asset upload",
        description: "Verify a directly uploaded asset in R2 and mark it available for updates",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Assets",
      description: "Asset upload endpoints",
    }),
  );
