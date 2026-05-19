import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { NotFound } from "../auth/ownership";
import { BadRequest, Conflict } from "../domain/errors";
import {
  CreateIosAppMetadataBody,
  DeleteIosAppMetadataResult,
  IosAppMetadata,
  UpdateIosAppMetadataBody,
} from "../domain/ios-app-metadata";

const idParam = HttpApiSchema.param("id", Schema.String);
const projectIdParam = HttpApiSchema.param("projectId", Schema.String);

export class IosAppMetadataGroup extends HttpApiGroup.make("iosAppMetadata")
  .add(
    HttpApiEndpoint.get("list")`/api/projects/${projectIdParam}/ios-app-metadata`
      .addSuccess(Schema.Struct({ items: Schema.Array(IosAppMetadata) }))
      .annotateContext(
        OpenApi.annotations({
          title: "List iOS App Store metadata",
          description: "List App Store Connect metadata entries for a project",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("create")`/api/projects/${projectIdParam}/ios-app-metadata`
      .setPayload(CreateIosAppMetadataBody)
      .addSuccess(IosAppMetadata, { status: 201 })
      .annotateContext(
        OpenApi.annotations({
          title: "Create iOS App Store metadata",
          description: "Register App Store Connect metadata for a bundle identifier",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("update")`/api/ios-app-metadata/${idParam}`
      .setPayload(UpdateIosAppMetadataBody)
      .addSuccess(IosAppMetadata)
      .annotateContext(
        OpenApi.annotations({
          title: "Update iOS App Store metadata",
          description: "Change ASC app id / sku / language / company name / app name",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.del("delete")`/api/ios-app-metadata/${idParam}`
      .addSuccess(DeleteIosAppMetadataResult)
      .annotateContext(
        OpenApi.annotations({
          title: "Delete iOS App Store metadata",
          description: "Remove an App Store metadata entry",
        }),
      ),
  )
  .addError(NotFound)
  .addError(Conflict)
  .addError(BadRequest)
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "iOS App Store metadata",
      description: "Per-project per-bundle App Store Connect metadata for submissions",
    }),
  ) {}
